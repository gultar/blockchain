//node.js

'use strict'

/********HTTP Server and protection************/
const express = require('express');
const http = require('http');
const bodyParser = require('body-parser');
const RateLimit = require('express-rate-limit');
const helmet = require('helmet');
//*********** Websocket connection**************/
const socketIo = require('socket.io')
const ioClient = require('socket.io-client');
//************Blockchain classes****************/
const { initBlockchain } = require('./backend/tools/blockchainHandler.js');
const Wallet = require('./backend/classes/wallet');
const Block = require('./backend/classes/block');
const Blockchain = require('./backend/classes/blockchain');
const Sidechain = require('./backend/classes/sidechain');
const Transaction = require('./backend/classes/transaction');
const NodeList = require('./backend/classes/nodelist');
const WalletManager = require('./backend/classes/walletManager');
const AccountCreator = require('./backend/classes/accountCreator');
const AccountTable = require('./backend/classes/accountTable');
const Miner = require('./backend/classes/miner')
/*************Smart Contract VM************** */
const callRemoteVM = require('./backend/contracts/build/callRemoteVM')
/**************Live instances******************/
const Mempool = require('./backend/classes/mempool'); //Instance not class


/****************Tools*************************/
const { displayTime, displayDate, logger, writeToFile, readFile, isHashPartOfMerkleTree } = require('./backend/tools/utils');
const {
  isValidTransactionJSON,
  isValidChainLengthJSON,
  isValidWalletRequestJSON,
  isValidGetNextBlockJSON,
  isValidHeaderJSON,
  isValidCreateWalletJSON,
  isValidUnlockWalletJSON,
  isValidWalletBalanceJSON,
  isValidActionJSON,
  isValidBlockJSON
} = require('./backend/tools/jsonvalidator');
const sha256 = require('./backend/tools/sha256');
const sha1 = require('sha1')
const chalk = require('chalk');
const fs = require('fs');
let Progress = require('pace');



/**
  Instanciates a blockchain node
  @constructor
  @param {string} $address - Peer Ip address
  @param {number} $port - Connection on port
*/

class Node {
  constructor(address, port, options){
    this.address = 'http://'+address+':'+port,
    this.port = port
    this.id = sha1(this.address);
    this.chain = {};
    this.blockFork = [];
    this.ioServer = {};
    this.publicKey = '';
    this.userInterfaces = [];
    this.peersConnected = {}; //From ioServer to ioClient
    this.connectionsToPeers = {}; //From ioClient to ioServer
    this.nodeList = new NodeList();
    this.minimumNumberOfPeers = 5;
    this.maximumUnconfirmedBlocks = 1;
    this.messageBuffer = {};
    this.updated = false;
    this.minerStarted = false;
    this.miner = {};
    this.verbose = false;
    this.walletManager = new WalletManager(this.address);
    this.accountCreator = new AccountCreator();
    this.accountTable = new AccountTable();
    this.longestChain = {
      length:0,
      peerAddress:'',
      totalChallenge:0,
    }

    if(options){

    }
    
  }


  /**
    P2P Server with two main APIs. A socket.io API for fast communication with connected peers
    and an HTTP Api for remote peer connections as well as routine tasks like updating blockchain.
  */
  startServer(app=express()){
    try{

      console.log(chalk.cyan('\n******************************************'))
      console.log(chalk.cyan('*')+' Starting node at '+this.address);
      console.log(chalk.cyan('******************************************\n'))
      // const expressWs = require('express-ws')(app);
      app.use(express.static(__dirname+'/views'));
      express.json({ limit: '300kb' })
      app.use(helmet())
      const server = http.createServer(app).listen(this.port);
      this.loadNodeConfig()
      this.initChainInfoAPI(app);
      this.initHTTPAPI(app);
      this.cleanMessageBuffer();
      this.ioServer = socketIo(server, {'pingInterval': 2000, 'pingTimeout': 10000, 'forceNew':false });
      
      //Loading blockchain from file
      initBlockchain()
        .then(chain => {
          if(chain){
            logger('Blockchain successfully loaded')
            this.chain = chain;

            //Loading transaction Mempool
            Mempool.loadMempool()
            .then((mempoolLoaded)=>{
              if(mempoolLoaded){
                logger('Loaded transaction mempool');
                logger('Number of transactions in pool: '+Mempool.sizeOfPool());
              }else{
                logger(chalk.red('ERROR: Could not load mempool'))
              }
            })

          }else{
            logger(chalk.red('ERROR: Could not init blockchain'))
          }
        })

      //Loading list of known peer addresses
      this.nodeList.loadNodeList()
        .then(loaded =>{
          if(loaded){
            logger('Loaded list of known nodes')
            logger('Number of known nodes:', this.nodeList.addresses.length)
          }else{
            logger(chalk.red('Could not load list of nodes'))
          }
        })

      this.accountTable.loadAllAccountsFromFile()
      .then(loaded =>{
        if(loaded){
          logger('Loaded account table');
        }else{
          logger(chalk.red('Could not load account table'))
        }
      })
      
    }catch(e){
      console.log(chalk.red(e));
    }

    this.ioServer.on('connection', (socket) => {
      if(socket){
         if(socket.handshake.query.token !== undefined){
             try{
               socket.on('message', (msg) => { logger('Client:', msg); });

               let peerToken = JSON.parse(socket.handshake.query.token);
               let peerAddress = peerToken.address;
               let peerPublicKey = peerToken.publicKey
               let peerChecksumObj = peerToken.checksum;

               if(peerChecksumObj){
                let peerTimestamp = peerChecksumObj.timestamp;
                let peerRandomOrder = peerChecksumObj.randomOrder;
                let peerChecksum = peerChecksumObj.checksum

                let isValid = this.validateChecksum(peerTimestamp, peerRandomOrder);
              
                if(isValid){
                  this.peersConnected[peerAddress] = socket;
                  this.nodeList.addNewAddress(peerAddress);
                  this.nodeEventHandlers(socket);
                }else{
                  socket.emit('message', 'Connected to local node');
                  this.externalEventHandlers(socket);
                }
               }
               
             }catch(e){
               console.log(chalk.red(e))
             }

         }else{
           socket.emit('message', 'Connected to local node')
           this.externalEventHandlers(socket);
         }
      }else{
        logger(chalk.red('ERROR: Could not create socket'))
      }

    });

    this.ioServer.on('disconnect', ()=>{ logger('a node has disconnected') })

    this.ioServer.on('error', (err) =>{ logger(chalk.red(err));  })
  }

  joinPeers(){
    try{
      if(this.nodeList.addresses){
        this.nodeList.addresses.forEach((peer)=>{
          this.connectToPeer(peer);
        })
      }
    }catch(e){
      console.log(chalk.red(e))
    }

  }

  findPeers(){
    if(Object.keys(this.connectionsToPeers).length > 0){
      logger('Requesting other peer addresses');
      this.serverBroadcast('getPeers');
    }else{
      this.joinPeers();
    }
  }

  getNumberOfConnectionsToPeers(){
    let connections = Object.keys(this.connectionsToPeers);
    return connections.length
  }

  seekOtherPeers(){
    let activePeersAddresses = this.getNumberOfConnectionsToPeers()
    if(activePeersAddresses.length < this.minimumNumberOfPeers){
      
    }
  }


  /**
    Basis for P2P connection
  */
  connectToPeer(address, callback){

    if(address && this.address !== address){
      if(!this.connectionsToPeers[address]){
        let connectionAttempts = 0;
        let peer;
        let timestamp = Date.now();
        let randomOrder = Math.random();
        let checksum = this.validateChecksum(timestamp, randomOrder)
        try{
          peer = ioClient(address, {
            'reconnection limit' : 1000,
            'max reconnection attempts' : 3,
            'pingInterval': 2000, 
            'pingTimeout': 10000,
            'query':
            {
              token: JSON.stringify({ 'address':this.address, 'publicKey':this.publicKey, 'checksum':{
                  timestamp:timestamp,
                  randomOrder:randomOrder,
                  checksum:checksum
                } 
              }),
              
            }
          });

          peer.heartbeatTimeout = 120000;

          if(this.verbose) logger('Requesting connection to '+ address+ ' ...');
          this.UILog('Requesting connection to '+ address+ ' ...');

          peer.on('connect_timeout', (timeout)=>{
            if(connectionAttempts >= 3) { 
              peer.destroy()
              delete this.connectionsToPeers[address];
            }else{
              connectionAttempts++;
            }
              
          })

          peer.on('error', (error)=>{
            console.log(error)
          })

          peer.on('connect', () =>{
            if(!this.connectionsToPeers[address]){

              logger(chalk.green('Connected to ', address))
              this.UILog('Connected to ', address+' at : '+ displayTime())
              peer.emit('message', 'Connection established by '+ this.address);
              peer.emit('connectionRequest', this.address);
              setTimeout(()=>{
                peer.emit('getBlockchainStatus')
              },1000);
              this.connectionsToPeers[address] = peer;
              this.nodeList.addNewAddress(address)
              
            }else{
              logger('Already connected to target node')
            }
          })

          peer.on('blockchainStatus', async (status)=>{
            if(!this.isDownloading){
              let updated = await this.receiveBlockchainStatus(peer, status);
            }
            
          })

          peer.on('whisper', (whisper)=>{
            let { type, originAddress, messageId, data, relayPeer }  = whisper;
            this.handleWhisperMessage(type, originAddress, messageId, data, relayPeer);
          })

          peer.on('getAddr', ()=>{
            peer.emit('addr', this.nodeList.addresses);
          })

          peer.on('disconnect', () =>{
            logger('connection with peer dropped');
            
          })

          if(callback){
            callback(peer)
          }



        }catch(err){
          logger(err);
        }

      }else{
        logger('Already initiated peer connection')
      }

    }
  }

  
  requestChainHeaders(peer, startAt=0, length=0){
    return new Promise((resolve, reject)=>{
        if(peer){
          if(!this.isDownloading){
            let headers = [];
            this.isDownloading = true;
            logger(chalk.cyan('Fetching block headers from peer...'))
    
            peer.emit('getBlockHeader', startAt+1)
    
            let bar = Progress({
              total:length - startAt,
              finishMessage:'Fetched all block headers of blockchain!\n\n'
            })

            const closeDownloadChannel = (peer, bar) =>{
              peer.off('block');
              bar = null;
              this.isDownloading = false;
            }
    
            peer.on('blockHeader', async (header)=>{
              if(header){
                bar.op()
                try{
                    if(header.error){
    
                      logger(header.error)
                      closeDownloadChannel(peer, bar)
                      resolve({error:header.error})
    
                    }
    
                    if(header.end){
    
                      if(this.verbose) logger('Headers fully synced')
                      closeDownloadChannel(peer, bar)
                      resolve(headers)
    
                    }else {
                      if(this.chain instanceof Blockchain){
                        let alreadyInChain = await this.chain.getIndexOfBlockHash(header.hash);
                        if(alreadyInChain){
                          logger('ERROR: Header already in chain');
                        }else{
                          let isValidHeader = this.chain.validateBlockHeader(header)
                          if(!isValidHeader){
                            logger('ERROR: Is not valid header')
                          }else{
                            headers.push(header);
                          }
                        }
                        peer.emit('getBlockHeader', header.blockNumber+1)
                      }else{
                        logger('ERROR: Blockchain not yet loaded')
                        closeDownloadChannel(peer, bar)
                        resolve({error:'ERROR: Blockchain not yet loaded'})
                      }
                      
                      
                    }
                }catch(e){
                  console.log(e)
                  closeDownloadChannel(peer, bar)
                  resolve({error:e})
                }
                
              } 
             })

          }//If is already downloading, do nothing

  
        }else{
          logger('ERROR: Header Request failed: Missing parameter');
          closeDownloadChannel(peer, bar)
          resolve({error:'ERROR: Header Request failed: Missing parameter'})
        }
      
    })
  }

  downloadBlockchain(peer, startAtIndex=0, length){
    return new Promise(async (resolve)=>{
        if(peer){
          let blocks = [];
          logger(chalk.cyan('Downloading blockchain from remote peer...'))

          let bar = Progress({
            total:length - startAtIndex,
            finishMessage:'Fetched all block headers of blockchain!\n\n'
          })
          this.isDownloading = true;

          const closeDownloadChannel = (peer, bar) =>{
            peer.off('block');
            bar = null;
            this.isDownloading = false;
          }

          peer.emit('getBlock', startAtIndex+1);
  
          peer.on('block', (block)=>{
            if(block){
              bar.op()
              if(block.error){
                logger(block.error)
                closeDownloadChannel(peer, bar)
                resolve({error:block.error})
              }
  
              if(block.end){
                  closeDownloadChannel(peer, bar)
                  resolve(blocks)
              }else{
                if(this.chain instanceof Blockchain){
                  let alreadyInChain = this.chain.getIndexOfBlockHash(block.hash)
                  if(alreadyInChain){
                    logger('ERROR: Block already synchronized');
                  }else{
                    blocks.push(block);
                  }
                  peer.emit('getBlock', block.blockNumber+1);
                }else{
                  logger('ERROR: Blockchain not yet loaded')
                  closeDownloadChannel(peer, bar)
                  resolve({error:'ERROR: Blockchain not yet loaded'})
                }
              }
    
            }else{
              logger('ERROR: No block received')
              closeDownloadChannel(peer, bar)
              resolve({error:'ERROR: No block received'})
            }
          })
      }else{
        logger('ERROR: Could not find peer to download from')
        closeDownloadChannel(peer, bar)
        resolve({error:'ERROR: Could not find peer to download from'})
      }
      
    })
    
  }

  downloadBlockFromHash(peer, hash){
    return new Promise(async (resolve)=>{
      if(peer && hash){
        
        peer.emit('getBlockFromHash', hash);

        peer.on('blockFromHash', (block)=>{
          if(block){

            if(block.error){
              logger(block.error)
              peer.off('blockFromHash');
              resolve(block.error)
            }

            peer.off('blockFromHash');
            resolve(block)

          }else{
            logger('ERROR: No block received')
          }
        })
      }
    })
  }

  createBlockFork(block){
    return new Promise(async (resolve) =>{
      if(block){

        let isStemOfFork

        if(this.chain.blockFork){

          let forkLength = this.chain.blockFork.length;
          
          let isLinkedToFork = this.chain.blockFork[forkLength - 1].hash == block.previousHash;
          
          if(isLinkedToFork){

            logger('BLOCK CONFLICT: Switching to side chain')
            let blockSwap = this.chain.chain.splice(-1, 1);
            this.unwrapBlock(blockSwap)
            this.chain.orphanedBlocks.push(blockSwap)
            this.chain.blockFork.push(block);

            this.chain.blockFork.forEach(async (block)=>{
              let blockSynced = await this.chain.pushBlock(block)

              if(blockSynced.error){
                logger(blockSynced.error);
              }

              if(blockSynced.fork){
                let display = JSON.stringify(blockSynced.fork, null, 2)
                logger(display)
              }

              if(blockSynced.resolved){
                let display = JSON.stringify(blockSynced.resolved, null, 2)
                logger(display)
              }

            })
            
          }else if(this.chain.blockFork[forkLength - 1].previousHash == block.previousHash){

          }else{

          }
        }else{

        }
       
      }
    })
  }


  receiveBlockchainStatus(peer, status){
    return new Promise(async (resolve) =>{
      if(this.chain instanceof Blockchain && peer && status){
        let { totalChallenge, bestBlockHeader, length } = status;
  
        if(totalChallenge && bestBlockHeader && length){
          
          let thisTotalChallenge = await this.chain.calculateWorkDone();
  
          if(thisTotalChallenge < totalChallenge){
            logger('Attempting to download blocks from peer')
            
            let isValidHeader = this.chain.validateBlockHeader(bestBlockHeader);
            if(isValidHeader){
              // let currentLastBlockNumber = this.chain.getLatestBlock().blockNumber
              let lastBlockNum = this.chain.getLatestBlock().blockNumber;
                
              let headers = await this.requestChainHeaders(peer, lastBlockNum, length)
              if(headers){
                
                if(headers.error){
                  logger(headers.error);
                  resolve(false)
                }
  
                let blocks = await this.downloadBlockchain(peer, lastBlockNum, length)
  
                if(blocks.error){
                  logger(blocks.error);
                  resolve(false)
                }
  
                if(blocks){
                  blocks.forEach( async(block)=>{
                    let addedBlock = await this.chain.pushBlock(block);
                    if(!addedBlock){
                      logger('ERROR: Could not add block')
                    }
                  })

                  this.updated = true;
                  resolve(true)
                }
  
              }else{
                logger('ERROR: Headers not found')
                resolve(false)
              }

              

            }else{
              logger('ERROR: Last block header from peer is invalid')
              resolve(false)
            }
          }else{
            logger('Blockchain is up to date with peer')
            this.updated = true;
          }

          

        }else{
          logger('ERROR: Status object is missing parameters')
          resolve(false)
        }
      }
    })
    
  }

  /**
    Broadcast only to this node's connected peers. Does not gossip
    @param {string} $eventType - Type of node event
    @param {object} $data - Various data to be broadcasted
  */
  serverBroadcast(eventType, data){
    this.ioServer.emit(eventType, data);
  }

  /**
    Broadcasts a defined event
    @param {string} $eventType - Event type/name
    @param {Object} $data - May be an object or any kind of data
    @param {Object} $moreData - Optional: any kind of data also
  */
  broadcast(eventType, data, moreData=false ){
    try{
      if(this.connectionsToPeers){
          Object.keys(this.connectionsToPeers).forEach((peerAddress)=>{
            if(!moreData){

                this.connectionsToPeers[peerAddress].emit(eventType, data);
            }else{
                this.connectionsToPeers[peerAddress].emit(eventType, data, moreData);
            }
          })
        }
    }catch(e){
      console.log(e);
    }

  }

  whisper(type, data, relayPeer){
    if(type){
      try{
        if(typeof data == 'object')
          data = JSON.stringify(data);
        var shaInput = (Math.random() * Date.now()).toString()
        var messageId = sha256(shaInput);
        this.messageBuffer[messageId] = messageId;
        this.serverBroadcast('whisper', { 
          'type':type, 
          'messageId':messageId, 
          'originAddress':this.address, 
          'data':data,
          'relayPeer':relayPeer
        });

      }catch(e){
        console.log(chalk.red(e));
      }

    }
  }

  handleWhisperMessage(type, originAddress, messageId, data, relayPeer){
    let gossipMessage = { 
      'type':type, 
      'originAddress':originAddress, 
      'messageId':messageId, 
      'data':data, 
      'relayPeer':relayPeer 
    }

    if(!this.messageBuffer[messageId]){
      switch(type){
        case 'blockchainStatus':
          try{
            let relayPeer = this.peersConnected[relayPeer];
            let status = JSON.parse(data)
            this.receiveBlockchainStatus(relayPeer, status)
          }catch(e){
            console.log(e)
          }
          
          break;
        case 'message':
          logger(data)
          break;
        default:
          break;
      }

        this.messageBuffer[messageId] = gossipMessage;
        this.whisper('gossip', gossipMessage, this.address)
    }
    
  }

  /**
    Relays certain console logs to the web UI
    @param {string} $message - Console log to be sent
    @param {object} $arg - Data of any type that can be console logged on web UI
  */
  outputToUI(message, arg){
    if(this.userInterfaces && message){
      for(var i=0; i < this.userInterfaces.length; i++){
        if(arg){
          //logger('Number of UIs', this.userInterfaces.length);
          this.userInterfaces[i].emit('message', message+' '+arg);
        }else{
          this.userInterfaces[i].emit('message', message);
        }

      }
    }

  }


  /**
    Send an node event to peer
    @param {string} $eventType - Event type/name
    @param {Object} $data - May be an object or any kind of data
    @param {string} $address - peer address
  */
  sendToPeer(eventType, data, address){
    if(address && this.connectionsToPeers[address]){
      try{
        this.connectionsToPeers[address].emit(eventType, data);
      }catch(e){
        console.log(chalk.red(e));
      }
    }
  }

  initChainInfoAPI(app){
    app.get('/getWalletBalance', async(req, res)=>{
      if(isValidWalletBalanceJSON(req.query)){
        let publicKey = req.query.publicKey;
        if(publicKey){
          res.json({ 
            balance: 
            this.chain.getBalanceOfAddress(publicKey) 
            + this.chain.checkFundsThroughPendingTransactions(publicKey)
          }).end()
        }else{
          res.json({error:'ERROR: must provide publicKey'}).end()
        }
      }else{
        res.json({error:'ERROR: Invalid JSON request parameters'}).end()
      }
    })

    app.get('/getWalletHistory', async(req, res)=>{
      if(isValidWalletBalanceJSON(req.query)){
        let publicKey = req.query.publicKey;
        if(publicKey){
          let history = await this.chain.getTransactionHistory(publicKey)
            res.json({ history:history }).end()
        }else{
          res.json({error:'ERROR: must provide publicKey'}).end()
        }
      }else{
        res.json({error:'ERROR: Invalid JSON request parameters'}).end()
      }
    })


    app.get('/getAddress', (req, res)=>{
      res.json({ nodes: this.nodeList.addresses }).end();
    })

    app.get('/getInfo', (req, res)=>{
      res.json(this.getChainInfo()).end()
    })

    app.get('/getBlock', (req, res)=>{
      let blockNumber = req.query.blockNumber;
      if(this.chain instanceof Blockchain && blockNumber){
        let block = this.chain.chain[blockNumber]
        if(block){
          res.json(block).end()
        }else{
          res.json({error:'block not found'}).end()
        }
        
      }
    })

    app.get('/getBlockHeader', (req, res)=>{
      let blockNumber = req.query.blockNumber;
      if(this.chain instanceof Blockchain && blockNumber){
        let header = this.chain.getBlockHeader(blockNumber)
        if(header){
          res.json(header).end()
        }else{
          res.json({error:'block header not found'}).end()
        }
        
      }
    })
  }


  /**
    Internode API that can be used by UIs to get data from blockchain and send transactions
    @param {Object} $app - Express App
  */
  initHTTPAPI(app){
    try{

      let rateLimiter = new RateLimit({
        windowMs: 1000, // 1 hour window 
        max: 100, // start blocking after 100 requests 
        message: "Too many requests per second"
      });

      app.use(rateLimiter);
      app.use(bodyParser.json());
      app.use(function (error, req, res, next) {
        if (error instanceof SyntaxError &&
          error.status >= 400 && error.status < 500 &&
          error.message.indexOf('JSON')) {
          res.send("ERROR: Invalid JSON format");
        } else {
          next();
        }
      });
      
      app.set('json spaces', 2)
      
      app.get('/transaction', (req, res)=>{
        let tx = {};
        let pendingTx = {};
        let hash = req.query.hash;
        
        if(hash){
          tx = this.chain.getTransactionFromChain(hash);
          if(tx){
            res.json(tx).end()
          }else{

            pendingTx = Mempool.getTransactionFromPool(hash);
            
            if(pendingTx){
              res.json(pendingTx).end()
            }else{
              res.json({ error:'no transaction found'}).end()
            }
            
          }
        }else{
          res.json({ error:'invalid transaction hash'}).end()
        }

      })
  
      app.post('/transaction', (req, res) => {
        
        try{
          if(isValidTransactionJSON(req.body)){
            let transaction = req.body
            
            this.broadcastNewTransaction(transaction)
            .then((transactionEmitted)=>{
              
              if(transactionEmitted.error){
                res.send(transactionEmitted.error)
              }else{
                let receipt = JSON.stringify(transaction, null, 2)
                res.send(receipt);
              }
            })
            .catch((e)=>{
              console.log(chalk.red(e));
            })
          }else{
            res.send('ERROR: Invalid transaction format')
          }
          
        }catch(e){
          console.log(chalk.red(e))
        }
        
      });

      app.post('/action', (req, res) => {
        
        try{
          if(isValidActionJSON(req.body)){
            let action = req.body
            
            this.broadcastNewAction(action)
            .then((actionEmitted)=>{
              if(!actionEmitted.error){
                res.send(JSON.stringify(actionEmitted, null, 2));
              }else{
                res.send(actionEmitted.error)
              }
            })
          }else{
            res.send('ERROR: Invalid transaction format')
          }
          
        }catch(e){
          console.log(chalk.red(e))
          res.send("ERROR: An Error occurred")
        }
        
      });

      app.get('/getBlockHeader',(req, res)=>{
        var blockNumber = req.query.hash;
        if(blockNumber){
          res.json(this.chain.getBlockHeader(blockNumber)).end()
        }
      })

    }catch(e){
      logger(e)
    }
    
  }


  /**
    Socket listeners only usable by server nodes
    @param {object} $socket - Client socket connection to this node's server
  */
  nodeEventHandlers(socket){
    if(socket){

     socket.on('error', (err)=>{
       logger(chalk.red(err));
     })

     socket.on('connectionRequest', (address)=>{
       this.connectToPeer(address, (peer)=>{
       });
     });

     socket.on('peerMessage', (data)=>{
       var { type, originAddress, messageId, data, relayPeer } = data
       this.handlePeerMessage(type, originAddress, messageId, data, relayPeer);
     })

     socket.on('gossipMessage', (data)=>{
      var { type, originAddress, messageId, data } = data
      this.handleGossipMessage(type, originAddress, messageId, data);
     })

     socket.on('directMessage', (data)=>{
      var { type, originAddress, targetAddress, messageId, data } = data
      this.handleDirectMessage(type, originAddress, targetAddress, messageId, data);
     });

     socket.on('disconnect', ()=>{
       if(socket.handshake.headers.host){
         var disconnectedAddress = 'http://'+socket.handshake.headers.host
         delete this.peersConnected[disconnectedAddress]
       }

     });

     socket.on('getBlockchainStatus', ()=>{
      if(this.chain instanceof Blockchain){
        try{
          let status = {
            totalChallenge: this.chain.calculateWorkDone(),
            bestBlockHeader: this.chain.getBlockHeader(this.chain.getLatestBlock().blockNumber),
            length: this.chain.chain.length
          }
          socket.emit('blockchainStatus', status);
         }catch(e){
           console.log(e)
         }
       }
        
     })

     socket.on('getBlockHeader', async (blockNumber)=>{
       if(blockNumber && typeof blockNumber == 'number'){
         let header = await this.chain.getBlockHeader(blockNumber);
         if(header){
           socket.emit('blockHeader', header)
         }else if(blockNumber == this.chain.getLatestBlock().blockNumber + 1){
           socket.emit('blockHeader', {end:'End of header chain'})
         }else{
          socket.emit('blockHeader', {error:'Header not found'})
         }
       }
     })

     socket.on('getBlock', (blockNumber)=>{
      if(this.chain instanceof Blockchain){
        if(blockNumber && typeof blockNumber == 'number'){
         
          let block = this.chain.chain[blockNumber];
          if(block){
            
            socket.emit('block', block)
            
          }else if(blockNumber == this.chain.getLatestBlock().blockNumber + 1){
            socket.emit('block', {end:'End of blockchain'})
          }else{
            socket.emit('block', {error:'Block not found'})
          }
          
         }
      }
     })

     socket.on('getBlockFromHash', (hash)=>{
      if(this.chain instanceof Blockchain){
        if(hash && typeof hash == 'string'){
         
          let blockIndex = this.chain.getIndexOfBlockHash(hash);
          if(blockIndex){
            let block = this.chain.chain[blockIndex];
            if(block){
              
              socket.emit('blockFromHash', block)
              
            }else if(blockIndex == this.chain.getLatestBlock().blockNumber + 1){
              socket.emit('blockFromHash', {end:'End of blockchain'})
            }else{
              socket.emit('blockFromHash', {error:'Block not found'})
            }
          }else{
            socket.emit('blockFromHash', {error:'Block not found'})
          }
          
          
         }
      }
     })


   }
  }


  /**
    Socket listeners only usable by external UIs and APIs
    @param {object} $socket - Client socket connection to this node's server
  */
  externalEventHandlers(socket){

    this.userInterfaces.push(socket)

    socket.on('error', (err)=>{
      logger(chalk.red(err));
    })

    socket.on('connectionRequest', (address)=>{
      this.connectToPeer(address, (peer)=>{});
    });

    socket.on('getBlockchain', ()=>{
      socket.emit('blockchain', this.chain);
    })

    socket.on('getAddress', (address)=>{
      this.requestKnownPeers(address);
    })

    socket.on('getKnownPeers', ()=>{
      socket.emit('knownPeers', this.nodeList.addresses);
    })

    socket.on('getInfo', ()=>{
      socket.emit('chainInfo', this.getChainInfo());
    })

    socket.on('getBlockHeader', (blockNumber)=>{
      let block = this.chain.chain[blockNumber];
      let blockInfo = {}
      if(block){
        
        blockInfo = {
          blockNumber:block.blockNumber,
          timestamp:block.timestamp,
          previousHash:block.previousHash,
          hash:block.hash,
          merkleRoot:block.merkleRoot,
          nonce:block.nonce,
          valid:block.valid,
          minedBy:block.minedBy,
          challenge:block.challenge,
          totalChallenge:block.totalChallenge,
          startMineTime:block.startMineTime,
          endMineTime:block.endMineTime,
          totalSumTransited:block.totalSumTransited,
          coinbaseTransactionHash:block.coinbaseTransactionHash
        }
      }else{
        blockInfo = {
          error: 'header not found'
        }
      }
      socket.emit('header', blockInfo)
    })

    socket.on('getBlock', (blockNumber)=>{
      let block = this.chain.chain[blockNumber];
      if(block){
        socket.emit('block', block)
      }else{
        socket.emit('block', {error:'ERROR: Block not found'})
      }
      
    })

    socket.on('getBlockSize', (number)=>{
      socket.emit('message', `Block number ${number-1} has ${Object.keys(this.chain.chain[number-1].transactions).length} transactions`)
    })

    socket.on('resolveInvalidChain', ()=>{
      this.validateBlockchain(true);
    })

    socket.on('startMiner', ()=>{
      this.minerStarted = true;
      this.createMiner()
    })

    socket.on('stopMining', ()=>{
      logger('Mining stopped')
      this.UILog('Mining stopped')
      if(process.ACTIVE_MINER){
        
        process.ACTIVE_MINER.send({abort:true});
        
      }
    })

    socket.on('isChainValid', ()=>{
      let isValidChain = this.validateBlockchain();
      if(isValidChain){
        logger('Blockchain is valid')
      }
    })


    socket.on('verbose', ()=>{
      
      if(this.verbose){
        this.UILog('Verbose set to OFF');
        this.verbose = false;
        
      }else{
        this.UILog('Verbose set to ON');
        this.verbose = true;
      }
      
      socket.emit('verboseToggled', this.verbose)
     
    })

    socket.on('getMempool', ()=>{
      socket.emit('mempool', Mempool);
    })
    
    socket.on('test', ()=>{
      var os = require('os'),
      cpuCount = os.cpus().length;
      console.log('CPU: ', cpuCount)
    
    })

    socket.on('rollback', ()=>{
      logger('Rolled back to block 2319')
      this.rollBackBlocks(2319)
    })

    socket.on('dm', (address, message)=>{
      console.log(`Sending: ${message} to ${address}`)
      this.sendDirectMessage('message', address, message)
    })

    socket.on('sumFee', async (number)=>{
      console.log(this.chain.gatherMiningFees(this.chain.chain[number]))
    })

    socket.on('getAccounts', (ownerKey)=>{
      if(ownerKey){
        let accounts = this.accountTable.getAccountsOfKey(ownerKey)
        socket.emit('accounts', accounts)
      }else{
        socket.emit('accounts', this.accountTable.accounts)
      }
        
    })


    socket.on('deleteAccounts', async()=>{
      let w = new Wallet();
      w = await w.importWalletFromFile(`./wallets/8003-b5ac90fbdd1355438a65edd2fabe14e9fcca10ea.json`);
      let account = this.accountTable.accounts['kayusha'];
      console.log(w)
      let unlocked = await w.unlock(this.port)
      let signature = await w.sign(account.hash);
      console.log(signature)
      let deleted = await this.accountTable.deleteAccount('kayusha', signature);
      if(deleted){
        logger(`Account kayusha got deleted`);
      }else{
        logger('Could not delete kayusha')
      }
      
     })
	
    socket.on('txSize', (hash)=>{
      if(Mempool.pendingTransactions.hasOwnProperty(hash)){
        let tx = Mempool.pendingTransactions[hash];
        
        logger('Size:'+ (Transaction.getTransactionSize(tx) / 1024) + 'Kb');
        console.log(tx.miningFee)
        console.log(this.chain.calculateTransactionMiningFee(tx))
      }else{
        logger('No transaction found');
        socket.emit('message', 'No transaction found')
      }
      
    })

    socket.on('resolveFork', ()=>{
      if(this.longestChain.peerAddress){
        logger('Resolving fork!');
        this.resolveBlockFork(this.longestChain.peerAddress);
      }else{
        socket.emit('message', 'ERROR: longest chain is unknown')
      }
    })

    socket.on('disconnect', ()=>{
      var index = this.userInterfaces.length
      this.userInterfaces.splice(index-1, 1)
    })
  }


  /**
    Basis for gossip protocol on network
    Generates a message uid to be temporarilly stored by all nodes
    to avoid doubles, then erased so that memory does not overflow.
    @param {string} $type - peer message type
  */
  sendPeerMessage(type, data){
    if(type){
      try{
        if(typeof data == 'object')
          data = JSON.stringify(data);
        var shaInput = (Math.random() * Date.now()).toString()
        var messageId = sha256(shaInput);
        this.messageBuffer[messageId] = messageId;
        this.broadcast('peerMessage', { 
          'type':type, 
          'messageId':messageId, 
          'originAddress':this.address, 
          'data':data,
          'relayPeer':this.address
         });

      }catch(e){
        console.log(chalk.red(e));
      }

    }
  }

  sendDirectMessage(type, targetAddress, data){
    if(type){
      try{
        if(typeof data == 'object')
          data = JSON.stringify(data);
        var shaInput = (Math.random() * Date.now()).toString()
        var messageId = sha256(shaInput);
        this.messageBuffer[messageId] = messageId;
        
        this.broadcast('directMessage', { 
         'type':type,
         'originAddress':this.address, 
         'targetAddress':targetAddress, 
         'messageId':messageId, 
         'data':data 
        });

      }catch(e){
        console.log(chalk.red(e));
      }

    }
  }

  


  /**
    @param {String} $type - Peer message type
    @param {String} $originAddress - IP Address of sender
    @param {Object} $data - Various data (transactions to blockHash). Contains messageId for logging peer messages
  */
  async handlePeerMessage(type, originAddress, messageId, data, relayPeer){
    if(data){
      try{
        let peerMessage = { 
          'type':type, 
          'originAddress':originAddress, 
          'messageId':messageId, 
          'data':data,
          'relayPeer':relayPeer 
        }
  
        if(!this.messageBuffer[messageId]){

          this.messageBuffer[messageId] = peerMessage;

          switch(type){
            case 'transaction':
              var transaction = JSON.parse(data);
              this.receiveTransaction(transaction);
              this.broadcast('peerMessage', peerMessage)
              break;
            case 'action':
              let action = JSON.parse(data);
              this.receiveAction(action);
              this.broadcast('peerMessage', peerMessage)
              break
            case 'newBlockFound':
              let added = await this.handleNewBlockFound(data, relayPeer);
              if(added.error) logger(added.error);
              peerMessage.relayPeer = this.address;
              this.broadcast('peerMessage', peerMessage)
              break;
            // case 'message':
            //   logger(chalk.green('['+originAddress+']')+' -> '+data)
            //   break;
          }
          // this.messageBuffer[messageId] = peerMessage;
          // this.broadcast('peerMessage', peerMessage)
          
        }
      }catch(e){
        console.log(e)
      }  
    }
    
  }

  handleDirectMessage(type, originAddress, targetAddress, messageId, data){
    let directMessage = { 
      'type':type, 
      'originAddress':originAddress, 
      'targetAddress':targetAddress, 
      'messageId':messageId, 
      'data':data 
    }
    if(!this.messageBuffer[messageId]){

      if(directMessage.originAddress == directMessage.targetAddress){
        return false;
      }

      if(this.address == directMessage.targetAddress){
        switch(type){
          case 'peerRequest':
          break;
          case 'accountRequest':
          break;
          case 'addressRequest':
          break;
          case 'chainLength':
            const length = data
            
            if(this.longestChain.length < length && this.nodeList.addresses.includes(originAddress)){
              
              this.longestChain.length = length;
              this.longestChain.peerAddress = originAddress
              logger(originAddress+' has sent its chain length: '+length)
            }
          break;
          case 'message':
              console.log(`!Received message from: ${originAddress}: ${data}`)
            break;
        }
      }else if(this.connectionsToPeers[targetAddress]){
        this.connectionsToPeers[targetAddress].emit('directMessage', directMessage)
      }else if(this.peersConnected[targetAddress]){
        this.peersConnected[targetAddress].emit('directMessage', directMessage)
      }else{
        this.messageBuffer[messageId] = directMessage;
        this.broadcast('directMessage', directMessage)
      }
      
    }
    
  }

  receiveTransaction(transaction){
    if(transaction && this.chain instanceof Blockchain){
      if(isValidTransactionJSON(transaction)){

        this.chain.validateTransaction(transaction)
        .then(valid => {
          if(!valid.error){
            Mempool.addTransaction(transaction);
            this.UILog('<-'+' Received valid transaction : '+ transaction.hash.substr(0, 15)+"...")
            if(this.verbose) logger(chalk.green('<-')+' Received valid transaction : '+ transaction.hash.substr(0, 15)+"...")
          }else{
            this.UILog('!!!'+' Received invalid transaction : '+ transaction.hash.substr(0, 15)+"...")
            if(this.verbose) logger(chalk.red('!!!'+' Received invalid transaction : ')+ transaction.hash.substr(0, 15)+"...")
            Mempool.rejectedTransactions[transaction.hash] = transaction;
            logger(valid.error)
          }
        })
        

      }
    }
  }

  receiveAction(action){
    if(action && isValidActionJSON(action)){
      //Check if is owner of contract or has permission
      let account = this.accountTable.getAccount(action.fromAccount.name)
      this.chain.validateAction(action, account)
      .then(isValid =>{
        if(isValid){
          //Action will be added to Mempool only is valid and if corresponds with contract call
          
          
          let mapsToContractCall = this.handleAction(action);
          if(mapsToContractCall){
            //Execution success message
            //Need to avoid executing call on everynode simultaneously 
            //Also need to avoid any security breach when signing actions
            if(this.verbose) logger(chalk.yellow('«-')+' Received valid action : '+ action.hash.substr(0, 15)+"...")
          
          }
        }else{
          logger(chalk.red('!!!')+' Rejected invalid action : '+ action.hash.substr(0, 15)+"...")
        }
        
      })
    }
  }

  getChainInfo(){
    let info = {
      chainLength:this.chain.chain.length,
      headBlockNumber:this.chain.getLatestBlock().blockNumber,
      headBlockHash:this.chain.getLatestBlock().hash,
      lastBlockTime:displayDate(new Date(this.chain.getLatestBlock().endMineTime)),
      minedBy:this.chain.getLatestBlock().minedBy,
    }
    return info
  }

  /**
    Validates every block that gets added to blockchain.
    @param {Object} $newBlock - Block to be added
  */
  async addNewBlock(newBlock){
      if(isValidBlockJSON(newBlock)){ //typeof newBlock == 'object'
        
        var isBlockSynced = await this.chain.pushBlock(newBlock);
        if(isBlockSynced){
          Mempool.deleteTransactionsFromMinedBlock(newBlock.transactions);
          logger(chalk.green('* Synced new block ')+newBlock.blockNumber+chalk.green(' with hash : ')+ newBlock.hash.substr(0, 25)+"...");
          logger(chalk.green('* Number of transactions: '), Object.keys(newBlock.transactions).length)
          logger(chalk.green('* By: '), newBlock.minedBy)
          return true;
        }else if(isBlockSynced.fork){
          //Handle forks
          return {fork:true}
        }else{
          return false;
        }
      }else{
        logger('ERROR: Block has invalid format');
        return false;
      }
  }

  handleNewBlockFound(data, relayPeer){
    return new Promise( async (resolve)=>{
      if(this.chain instanceof Blockchain && data && relayPeer){
        try{
          let header = JSON.parse(data);
          let alreadyReceived = this.chain.getIndexOfBlockHash(header.hash)
          let alreadyIsInActiveFork = this.chain.blockFork[header.hash];
          if(!alreadyReceived && !alreadyIsInActiveFork){
            if(this.chain.validateBlockHeader(header)){
              let peerSocket = this.connectionsToPeers[relayPeer]
              if(peerSocket){
                
                  if(this.miner){
                    clearInterval(this.miner.minerLoop);
                    if(process.ACTIVE_MINER){
                      process.ACTIVE_MINER.send({abort:true});
                      
                    }
                    delete this.miner;
                  }
    
                  let newBlock = await this.downloadBlockFromHash(peerSocket, header.hash)
                  if(newBlock.error){
                    resolve({error:newBlock.error})
                  }else{

                    let addedToChain = await this.chain.pushBlock(newBlock);
                    if(addedToChain.error){
                      resolve({error:addedToChain.error})
                    }
      
                    if(addedToChain.fork){
                      logger(addedToChain.fork)
                    }
      
                    if(addedToChain.resolved){
                      logger(addedToChain.resolved)
                    }
      
      
                    if(this.minerStarted && !this.miner){
                      this.createMiner()
                    }
                    
                    resolve(true);
                  }
              }else{
                resolve({error:'ERROR:Relay peer could not be found'})
              }
            }else{
              resolve({error:'ERROR:New block is invalid'})
            }
          }
        }catch(e){
          console.log(e);
          resolve({error:e})
        }
 
      }else{
        resolve({error:'ERROR: Missing parameters'})
      }
    })
    
  }


  validateBlockchain(allowRollback){
    if(this.chain instanceof Blockchain){
      let isValid = this.chain.isChainValid();
      if(isValid.conflict){
        let atBlockNumber = isValid.conflict;
        if(allowRollback){
          this.rollBackBlocks(atBlockNumber-1);
          logger('Rolled back chain up to block number ', atBlockNumber-1)
          return true;
        }else{
          return false;
        }
      }

      return true;
    }
  }

   //could be moved to Blockchain.js
  compareHeaders(headers){
    // logger(headers)
    if(this.chain instanceof Blockchain){
      if(headers){
        for(var i=0; i < headers.length; i++){

          var header = headers[i]
          var localBlockHeader = this.chain.getBlockHeader(i);

          try{
            
            if(i > 1 && isValidHeaderJSON(header)){
              let isValid = this.chain.validateBlockHeader(header);
              let containsBlock = localBlockHeader.hash == header.hash;
              

              if(!containsBlock) {
                console.log('Does not contain block ',i)
                return i
              };
              if(!isValid){
                console.log('Is not valid ', i);
                console.log(sha256(header.previousHash + header.timestamp + header.merkleRoot + header.nonce))
                
                console.log('Block Hash:', block.hash);
                console.log('Header Hash',header.hash);
                console.log(sha256(block.previousHash + block.timestamp + block.merkleRoot + block.nonce))
                
                console.log('Previous hash', header.previousHash);
                console.log('Timestamp', header.timestamp);
                console.log('Merkle', header.merkleRoot);
                console.log('Nonce', header.nonce)
                return false;
              }
              if(headers.length < this.chain.chain.length){
                logger('This chain is longer than peer chain')
                return false;
              } 
            }

          }catch(e){
            console.log(e)
          }


        }
        return true;
      }
    }
  }

   /**
    @param {number} $number - Index of block from which to show block creation time
   */
  showBlockTime(number){
     try{
       if(this.chain instanceof Blockchain){
         var latestBlock = this.chain.chain[number];
         var indexBeforeThat = latestBlock.blockNumber-1;
         var blockBeforeThat = this.chain.chain[indexBeforeThat];
         return ((latestBlock.timestamp - blockBeforeThat.timestamp)/1000)
       }
     }catch(e){
       console.log(chalk.red(e))
     }

  }


  rollBackBlocks(blockIndex){  //Tool to roll back conflicting blocks - To be changed soon
    if(typeof blockIndex == 'number' && this.chain instanceof Blockchain){
      var sideChain = [];
      sideChain = this.chain.chain.splice(blockIndex);
      sideChain.forEach((block)=>{
        this.unwrapBlock(block);
        this.chain.orphanedBlocks.push(block)
      })

      return sideChain;
    }
  }


  /**
    @desc Emits all transactions as peerMessages.
    @param {string} $sender - Sender of coins's Public key
    @param {string} $receiver - Receiver of coins's Public key
    @param {number} $amount - Amount of coins to send. Optional IF blockbase query
    @param {object} $data - data to send along with transaction
  */
  async broadcastNewTransaction(transaction){
    return new Promise( async (resolve, reject)=>{
      try{
          if(this.chain instanceof Blockchain){
            if(!transaction.signature){
              logger('Transaction signature failed. Missing signature')
              resolve({error:'Transaction signature failed. Missing signature'})
              
            }else{
              
              this.chain.createTransaction(transaction)
                .then( valid =>{
                  if(!valid.error){
  
        
                    Mempool.addTransaction(transaction);
                    this.UILog('Emitted transaction: '+ transaction.hash.substr(0, 15)+"...")
                    if(this.verbose) logger(chalk.blue('->')+' Emitted transaction: '+ transaction.hash.substr(0, 15)+"...")
                    
                    this.sendPeerMessage('transaction', JSON.stringify(transaction, null, 2)); //Propagate transaction
                    resolve(transaction)
  
                  }else{
  
                    this.UILog('!!!'+' Rejected transaction : '+ transaction.hash.substr(0, 15)+"...")
                    if(this.verbose) logger(chalk.red('!!!'+' Rejected transaction : ')+ transaction.hash.substr(0, 15)+"...")
                    resolve({error:valid.error});
  
                  }
                })
            }
          }
         
        
        
      }catch(e){
        console.log(chalk.red(e));
      }
    })
  }

  handleAction(action){
    switch(action.type){
      case 'account':
        if(action.task == 'create'){
          this.accountTable.addAccount(action.data);
        }
        break;
      case 'getValue':
        this.executeAction(action)
        break;
      case 'setValue':
        this.executeAction(action)
        break;
      default:
        logger('ERROR: Invalid contract call')
        return false;
    }
    Mempool.addAction(action)
    return true;
  }

  executeAction(action){
    //To be implemented
  }

  broadcastNewAction(action){
    return new Promise((resolve, reject)=>{
      try{

        let linkedAccount = this.accountTable.getAccount(action.fromAccount.name);

        if(!action.signature){
          logger('ERROR: Action could not be emitted. Missing signature')
          resolve({error:'Action could not be emitted. Missing signature'})
        }else{

          if(action.type == 'account' && action.task == 'create' && linkedAccount ){
            resolve({error:"Account already exists"});
            
          }else{
            this.chain.validateAction(action, linkedAccount)
            .then(valid=>{
              if(valid && !valid.error){
                let mapsToContractCall = this.handleAction(action);
                if(mapsToContractCall){
                  //Execution success message
                  //Need to avoid executing call on everynode simultaneously 
                  //Also need to avoid any security breach when signing actions
                  if(this.verbose) logger(chalk.cyan('-»')+' Emitted action: '+ action.hash.substr(0, 15)+"...")
                  this.sendPeerMessage('action', JSON.stringify(action, null, 2)); //Propagate transaction
                }
                
                resolve(action)
              }else{
                logger('ERROR: Action is invalid')
                resolve({error:valid.error})
              }
            })
          }
          
        }
        
        
        
      }catch(e){
        console.log(e)
      }
    })
  }

  generateReceipt(sender, receiver, amount, data, signature, hash){
    const receipt = 
    `Transaction receipt:
    Sender: ${sender}
    Receiver: ${receiver}
    Amount: ${amount}
    Sent at: ${Date.now()}
    Signature: ${signature}
    Hash: ${hash}`

    return receipt
  }

  generateWalletCreationReceipt(wallet){
    const receipt = 
    `Created New Wallet!
     Wallet Name: ${wallet.name}
     Public key:${wallet.publicKey}
     Wallet id: ${wallet.id}
     Keep your password hash safe!`;

     return receipt;
  }

  forceMine(){
    logger('Starting miner!')
    this.outputToUI('Starting miner!')
    this.startMiner();
  }


  update(){
    this.gossip('getBlockchainStatus')
  }

  /**
    @desc Miner loop can be launched via the web UI or upon Node boot up
  */
  createMiner(){
    if(this.chain instanceof Blockchain && this.minerStarted){

      this.miner = new Miner({
        chain:this.chain,
        address:this.address,
        publicKey:this.publicKey,
        verbose:this.verbose,
      })

      this.miner.start((block)=>{
        if(block){
          let newHeader = this.chain.getBlockHeader(block.blockNumber);
          this.sendPeerMessage('newBlockFound', newHeader);
          this.createMiner();
        }
        
      });
    }else{
      logger('ERROR: Could not start miner')
    }
  }

  pauseMiner(state){
    if(this.miner && typeof state == 'boolean'){
      this.miner.minerPaused = state;
    }
  }

  unwrapBlock(block){
    if(isValidBlockJSON(block)){
      let transactionsOfCancelledBlock = block.transactions;
      let actionsOfCancelledBlock = block.actions
      Mempool.putbackPendingTransactions(transactionsOfCancelledBlock);
      Mempool.putbackPendingActions(actionsOfCancelledBlock)
      this.cashInCoinbaseTransactions();
    }
    
    
  }

  cashInCoinbaseTransactions(){
    return new Promise((resolve, reject)=>{
      if(Mempool.pendingCoinbaseTransactions){
        let hashes = Object.keys(Mempool.pendingCoinbaseTransactions);
        
        hashes.forEach( async(hash) =>{
          let transaction = Mempool.pendingCoinbaseTransactions[hash];
          
            if(transaction){
              let readyToMove = await this.chain.validateCoinbaseTransaction(transaction);
              
              if(readyToMove && !readyToMove.error && !readyToMove.pending){
                
                Mempool.moveCoinbaseTransactionToPool(transaction.hash);
                this.sendPeerMessage('transaction',transaction);
                resolve(true);
                
              }else{
                if(readyToMove.error){
                  logger('Rejected Transaction:', transaction.hash)
                  logger(readyToMove.error);
                  Mempool.rejectCoinbaseTransaction(transaction.hash);

                }else if(readyToMove.pending){
                  //Do nothing
                }
              }
                
              
            }else{
              logger('ERROR: coinbase transaction not found');
              resolve({error:'ERROR: coinbase transaction not found'})
            }
           
        })
        
      }
    })
  
  }

  save(callback){
    
    this.chain.saveBlockchain()
      .then((saved)=>{
        
        this.nodeList.saveNodeList();
        Mempool.saveMempool();
        this.walletManager.saveState();
        this.saveNodeConfig()
        this.accountTable.saveTable();
        if(saved == true){
          logger('Saved blockchain file')
          if(callback) callback(true);
          return true;
        }else{
          logger(chalk.red('ERROR: could not write blockchain file'));
          if(callback) callback(false);
          return false;
        }
        
      })
      .catch((e)=>{
        console.log(chalk.red(e))
      })
    
  }

  async loadNodeConfig(){
    fs.exists('./config/nodeconfig.json', async (exists)=>{
      if(exists){
        let nodeConfigString = await readFile('./config/nodeconfig.json');
        try{
          if(nodeConfigString){
            let nodeConfig = JSON.parse(nodeConfigString);
            this.address = nodeConfig.address;
            this.port = nodeConfig.port;
            this.id = nodeConfig.id;
            this.publicKey = nodeConfig.publicKey;
            // this.accountTable = nodeConfig.accountTable;
            logger('Loaded node config')
          }
          
        }catch(e){
          logger(e)
        }
      }else{
        this.saveNodeConfig();
      }
    })
  }

  async saveNodeConfig(){
    let config = {
      address:this.address,
      port:this.port,
      id:this.id,
      publicKey:this.publicKey,
      // accountTable:this.accountTable,
    }

    let saved = await writeToFile(JSON.stringify(config, null, 2),'./config/nodeconfig.json');
    if(saved) logger('Saved node config')
  }

  /**
    @desc Periodically clears out peer messages to avoid overflow
  */
  cleanMessageBuffer(){
    var that = this;
    setInterval(()=>{
      that.messageBuffer = {};
      
    }, 30000)
  }

  UILog(message, arg){
    if(arg){
      this.outputToUI(message, arg)
    }else{
      this.outputToUI(message)
    }
  }

  async validateChecksum(timestamp, randomOrder){
    let nodeChecksum = '';
    let blockchainChecksum = '';
    let blockChecksum = '';
    let challengeChecksum = '';
    let transactionChecksum = '';

    let nodeFile = await readFile('./node.js');
    let blockchainFile = await readFile(`./backend/classes/blockchain.js`);
    let blockFile = await readFile(`./backend/classes/block.js`);
    let challengeFile = await readFile(`./backend/classes/challenge.js`);
    let transactionFile = await readFile(`./backend/classes/transaction.js`);

    if(nodeFile && blockchainFile && blockFile && challengeFile && transactionFile){
      nodeChecksum = await sha256(nodeFile)
      blockchainChecksum = await sha256(blockchainFile)
      blockChecksum = await sha256(blockFile)
      challengeChecksum = await sha256(challengeFile)
      transactionChecksum = await sha256(transactionFile);

      let checksumArray = [
        nodeChecksum,
        blockchainChecksum,
        blockChecksum,
        challengeChecksum,
        transactionChecksum
      ]
  
      checksumArray.sort((a, b)=>{
        return 0.5 - randomOrder;
      })
  
      let finalChecksum
      checksumArray.forEach( checksum=>{
        finalChecksum = finalChecksum + checksum;
      })
  
      finalChecksum = sha256(finalChecksum + timestamp.toString()) ;
      return finalChecksum;

    }else{
      return false;
    }
    
  }

}


module.exports = new Node()
