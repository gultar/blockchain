/**
 TFLB | Thousandfold Blockchain
 @author: Sacha-Olivier Dulac
*/


/////////////////////Blockchain///////////////////////
const chainLog = require('debug')('chain')
const contractLog = require('debug')('contract')
const sha256 = require('../../tools/sha256');
const {  
  logger, 
  RecalculateHash, 
  writeToFile,
  validatePublicKey,
  merkleRoot, 
  readFile, } = require('../../tools/utils');
const { isValidAccountJSON, isValidHeaderJSON, isValidBlockJSON, isValidTransactionJSON, isValidActionJSON } = require('../../tools/jsonvalidator');
const Transaction = require('../transactions/transaction');
const Factory = require('../contracts/build/callFactory')
const VMController = require('../contracts/vmController')
/******************************************** */

let { accountTable, balance } = require('../../instances/tables')
let { mempool } = require('../../instances/mempool')

const Block = require('./block');
const Consensus = require('./consensus')
const { setNewChallenge, setNewDifficulty, Difficulty } = require('../mining/challenge');
const chalk = require('chalk');
const ECDSA = require('ecdsa-secp256r1');
const fs = require('fs');
let _ = require('private-parts').createKey();
const genesis = require('../../tools/getGenesis')
const Database = require('../database/db')
/**
  * @desc Basic blockchain class.
  * @param {Array} $chain Possibility of instantiating blockchain with existing chain. 
  *                       Not handled by default
*/
class Blockchain{

  constructor(chain=[]){
    this.chain = chain
    this.blockPool = {}
    this.chainSnapshot = {}
    this.chainDB = new Database('blockchain');
    this.contractDB = new Database('contracts');
    this.consensusMode = genesis.consensus
    this.difficulty = new Difficulty(genesis)
    this.consensus = new Consensus({
      consensusMode:this.consensusMode,
      chain:this.chain,
      getBlock:async (blockNumber)=>{
        return await this.getBlockFromDB(blockNumber)
      },
      difficulty:this.difficulty,
      accountTable:accountTable
    })
    this.spentTransactionHashes = {}
    this.spentActionHashes = {}
    this.isSyncingBlocks = false
    this.branches = {}
    this.unlinkedBranches = {}
    this.looseBlocks = {}
    this.miningReward = 50;
    this.blockSize = 5; //Minimum Number of transactions per block
    this.maxDepthForBlockForks = 3;
    this.transactionSizeLimit = 10 * 1024;
  }

  async createGenesisBlock(){
    let genesisBlock = new Block({
      timestamp:1554987342039,
      transactions:{ 
            'maxCurrency':new Transaction
            ({
              fromAddress:'coinbase',
              toAddress:'coinbase',
              amount:1000 * 1000 * 1000 * 1000,
              data:'Maximum allowed currency in circulation',
              type:'coinbaseReserve',
              hash:false,
              miningFee:0
            }),
          },
      actions:{}
    })
    genesisBlock.difficulty = '0x1024'//'0x100000';//'0x2A353F';
    genesisBlock.totalDifficulty = genesisBlock.difficulty
    genesisBlock.challenge = setNewChallenge(genesisBlock)
    genesisBlock.blockTime = 10
    genesisBlock.consensus = "Proof of Work" //Possible values : Proof of Work, Permissioned, Proof of Stake, Proof of Importance
    genesisBlock.network = "mainnet"
    genesisBlock.maxCoinSupply = Math.pow(10, 10);
    genesisBlock.signatures = {}
    genesisBlock.hash = sha256( genesisBlock.maxCoinSupply + genesisBlock.difficulty + genesisBlock.challenge + genesisBlock.merkleRoot + genesisBlock.signatures )
    genesisBlock.calculateHash();
    genesisBlock.states = {
      //Other public addresses can be added to initiate their balance in the genesisBlock
      //Make sure at least one of the them has some funds, otherwise no transactions will be possible
      "coinbase":{ balance:1000 * 1000 * 1000 * 1000 },
      "Axr7tRA4LQyoNZR8PFBPrGTyEs1bWNPj5H9yHGjvF5OG":{ balance:10000 },
      "AodXnC/TMkd6rcK1m3DLWRM14G/eMuGXWTEHOcH8qQS6":{ balance:10000 },
      "A2TecK75dMwMUd9ja9TZlbL5sh3/yVQunDbTlr0imZ0R":{ balance:10000 },
      "A64j8yr8Yl4inPC21GwONHTXDqBR7gutm57mjJ6oWfqr":{ balance:10000 },
    }

    return genesisBlock
  }
  /**
   * Stores Genesis block to database as well as coinstore transaction
   * @param {Block} genesisBlock 
   */
  genesisBlockToDB(genesisBlock){
    return new Promise(async (resolve)=>{
      
      let added = await this.chainDB.put({
          id:'0',
          key:'0',
          value:genesisBlock
      })

      if(added.error) resolve({error:added.error})
      resolve(added)
        
    })
    
  }

  /**
   * Replaces current Genesis block with another version
   * Use carefully because it can invalidate the whole blockchain
   * @param {Block} peerGenesisBlock 
   */
  genesisBlockSwap(peerGenesisBlock){
    return new Promise(async (resolve)=>{
      if(peerGenesisBlock){
        if(peerGenesisBlock.hash !== this.chain[0].hash && peerGenesisBlock.blockNumber.toString() == '0'){
          this.chain[0] = peerGenesisBlock
          let addedNewGenesisBlock = await this.chainDB.add({
              _id:'0',
              ['0']:peerGenesisBlock
          })
          resolve(addedNewGenesisBlock)
        }else{
          resolve(true)
        }

      }
    })
    
  }
  /**
   * Creates a new genesisBlock json file in /config
   * Needed to create a new blockchain
   */
  saveGenesisFile(){
    return new Promise(async (resolve)=>{
      let genesisBlock = this.createGenesisBlock();
      let saved = await writeToFile(genesisBlock, './config/genesis.json')
      if(saved){
        resolve(genesisBlock)
      }else{
        resolve({error:'Could not save genesis file'})
      }
    })
  }

  /**
   * Fetches existing genesisBlock
   */
  loadGenesisFile(){
    return new Promise(async (resolve)=>{
      fs.exists('./config/genesis.json', async (exists)=>{
        if(exists){
          let genesis = await readFile('./config/genesis.json');
          if(genesis){
            genesis = JSON.parse(genesis)
            resolve(genesis)
          }else{
            resolve({error:'Could not load genesis file'})
          }
        }else{
          let genesis = await this.saveGenesisFile();
          if(!genesis.error){
            resolve(genesis)
          }else{
            resolve({error:'Could not load genesis file'})
          }
        }
        
      })
      
    })
  }

  
  getLatestBlock(){
    return this.chain[this.chain.length - 1];
  }

  /**
   * @desc Helper function to get the latest full block, not just the header
   */
  async getLatestFullBlock(){
    let latestHeader = this.getLatestBlock()
    let block = await this.getBlockFromDB(latestHeader.blockNumber)
    if(!block || block.error){
      block = await this.getBlockFromDB(latestHeader.blockNumber - 1)
    }

    return block
  }



  async receiveBlock(newBlock){
    if(isValidBlockJSON(newBlock)){
      //Already exists in chain?
      let blockAlreadyExists = await this.getBlockbyHash(newBlock.hash)
      if(blockAlreadyExists) return { error:`ERROR Block ${newBlock.blockNumber} already exists` }
      //Is none of the above, carry on with routing the block
      //to its proper place, either in the chain or in the pool
      let success = await this.routeBlock(newBlock)
      chainLog('New Block '+newBlock.blockNumber+' routed:', success)
      return success
      
    }else{
      return { error:`ERROR: Block does not have valid structure` }
    }
  }

  async routeBlock(newBlock){
    let isValidBlock = await this.validateBlock(newBlock)
    chainLog('New block is valid ', isValidBlock)
    if(isValidBlock.error) return { error:isValidBlock.error }
    else{

      let isNextBlock = newBlock.blockNumber == this.getLatestBlock().blockNumber + 1
      let isLinked = newBlock.previousHash == this.getLatestBlock().hash
      if(isNextBlock && isLinked) return { readyToExecute:true } //return await this.addBlock(newBlock)
      else{

        chainLog('New block not add to chain')
        chainLog('Is next block?', isNextBlock)
        chainLog('Is linked?', isLinked)

        let isTenBlocksAhead = newBlock.blockNumber >= this.getLatestBlock().blockNumber + 5
        if(isTenBlocksAhead){
          //In case of a major fork
          chainLog('Is ten blocks ahead, rolling back')

          let rollback = await this.rollbackToBlock(this.getLatestBlock().blockNumber - 20)
          if(rollback.error) return { error:rollback.error }
          else return { requestUpdate:true }
        }
        
        let isLinkedToBlockInPool = await this.getBlockFromPool(newBlock.previousHash)
        if(isLinkedToBlockInPool){
          let blockFromPool = isLinkedToBlockInPool
          let branch = [ blockFromPool, newBlock ]

          chainLog('Block direct to block pool but is linked')
          chainLog('Checking if both blocks have more work than this latest block')

          let isValidCandidate = await this.validateBranch(newBlock, branch)
          chainLog('Is valid Candidate:', isValidCandidate)
          if(isValidCandidate) return { rollback:blockFromPool.blockNumber - 1 }
          else return { stay:true }
        }else{
          chainLog('Block is sent to block pool')
          return await this.addBlockToPool(newBlock)
        }

      } //

    }
  }

  //deprecated
  async addBlock(newBlock){
    let newHeader = this.extractHeader(newBlock)
    this.chain.push(newHeader);
    let executed = await this.processBlock(newBlock)
    chainLog('Block executed:', executed)
    if(executed.error){
      this.chain.pop()
      return { error:executed.error }
    }
    else {
      let added = await this.addBlockToDB(newBlock)
      chainLog('Block added to DB', added)
      if(added.error){
        this.chain.pop()
        return { error:added.error }
      }
      else{
        await this.manageChainSnapshotQueue(newBlock)
        logger(`${chalk.green('[] Added new block')} ${newBlock.blockNumber} ${chalk.green('to chain:')} ${newBlock.hash.substr(0, 20)}...`)
        
        return added
      }
    }
  }

  async addBlockToPool(newBlock){
    //Already exists in block pool?
    let blockExistsInPool = await this.getBlockFromPool(newBlock.hash)
    if(blockExistsInPool && blockExistsInPool.error) return { error:blockExistsInPool.error }
    else if(blockExistsInPool) return { error:`ERROR: Block ${newBlock.blockNumber} already exists in pool` }
    else{
      this.blockPool[newBlock.hash] = newBlock
      let blockPoolHashes = Object.keys(this.blockPool)
      if(blockPoolHashes.length > 30){
        let firstBlockHash = blockPoolHashes[0]
        delete this.blockPool[firstBlockHash]
      }
      logger(`${chalk.cyan('[] Added block')} ${newBlock.blockNumber} ${chalk.cyan('to pool:')} ${newBlock.hash.substr(0, 20)}...`)
      
      return  { pooled:true }
    }
    
  }

  async getBlockFromPool(hash){
    let block = this.blockPool[hash]
    if(block){
      return block
    }else{
      return false
    }
  }

  async validateBranch(newBlock, branch){
       
      let forkTotalDifficulty = BigInt(parseInt(newBlock.totalDifficulty, 16))
      let currentTotalDifficulty = BigInt(parseInt(this.getLatestBlock().totalDifficulty, 16))
      let branchHasMoreWork = (forkTotalDifficulty > currentTotalDifficulty)

      let branchIsMuchLonger = branch.length - this.chain.length >= 5
      
      if(branchHasMoreWork || branchIsMuchLonger){
        return true
      }else{
        return false
      }
    
  }

  async processBlock(newBlock){
    let newHeader = this.extractHeader(newBlock)

    let executed = await balance.runBlock(newBlock)
    chainLog('Balances executed', executed)
    if(executed.error) return { error:executed.error }

    let saved = await balance.saveBalances(newBlock)
    chainLog('Balances saved', saved)
    if(saved.error) return { error:saved.error }

    for await(let hash of newHeader.txHashes){
      let transaction = newBlock.transactions[hash]
      if(transaction.type == 'payable'){
        chainLog('Payable spent', hash)
        this.spentTransactionHashes[hash] = newHeader.blockNumber
        chainLog('Linked to ', hash)
        this.spentTransactionHashes[transaction.reference.hash] = { referenceTo:hash }
      }else{
        chainLog('Transaction spent', hash)
        this.spentTransactionHashes[hash] = newHeader.blockNumber
      }
    }

    if(newHeader.actionsHashes){
      for await(let hash of newHeader.actionHashes){
        chainLog('Action spent', hash)
        this.spentActionHashes[hash] = newHeader.blockNumber//{ spent:newHeader.blockNumber }
      }
    }

    let savedLastBlock = await this.saveLastKnownBlockToDB()
    chainLog('Saved last known block', savedLastBlock)
    if(savedLastBlock.error) return { error:savedLastBlock.error }

    return true
  }

  async getMedianBlockTime(){
    let totalBlockTime = 0
    for await(let header of this.chain){
      if(header.blockNumber > 0){
        let block = await this.getBlockFromDB(header.blockNumber)
        totalBlockTime += (( block.endMineTime - block.startMineTime ) / 1000)
      }
    }

    return (totalBlockTime / this.chain.length)
  }

  getLastKnownBlockFromDB(){
    return new Promise(async (resolve)=>{
        let lastBlockEntry = await this.chainDB.get('lastBlock')
        if(lastBlockEntry && Object.keys(lastBlockEntry).length > 0){
            if(lastBlockEntry.error) resolve({error:lastBlockEntry.error})
            let lastBlock = lastBlockEntry[lastBlockEntry._id]
            if(lastBlock){
              resolve(lastBlock)
            }else{
              if(this.chain.length > 0){
                resolve(this.chain[0])
              }else{
                resolve({blockNumber:0})
              }
            }

            
        }else{
          
          if(this.chain.length > 0){
            resolve(this.chain[0])
          }else{
            resolve({blockNumber:0})
          }
        }
    })
  }

  saveLastKnownBlockToDB(){
    return new Promise(async (resolve)=>{
        let latestBlock = await this.getBlockFromDB( this.getLatestBlock().blockNumber)
        let fallBack = await this.getBlockFromDB( this.getLatestBlock().blockNumber - 1)
        let blockToSet = latestBlock
        if(!latestBlock || latestBlock.error){
          blockToSet = fallBack
        }
        let saved = await this.chainDB.add({
          _id:'lastBlock',
          'lastBlock':blockToSet
        })
        if(saved.error) resolve({error:saved})
        else resolve(saved)
    })
  }

  addBlockToDB(block){
    return new Promise(async (resolve)=>{
      
      let put = await this.chainDB.add({
          _id:block.blockNumber.toString(),
          [block.blockNumber]:block
      })
      
      if(put.error) resolve({error:put.error})
      resolve(put)

    })
  }

  getBlockFromDB(blockNumber){
    return new Promise(async (resolve)=>{
      
      let blockEntry = await this.chainDB.get(blockNumber.toString())
      if(blockEntry){
        
        if(blockEntry .error) resolve({error:blockEntry .error})
        let block = blockEntry[blockEntry._id]
        resolve(block)
      }else{
        resolve(false)
      }
    })
  }

  async getBlockFromDBByHash(hash){
      let header = await this.getBlockbyHash(hash)
      if(header){
        let block = await this.getBlockFromDB(header.blockNumber)
        if(block.error) return { error:block.error }
        else return block
      }else{
        return false
      }
  }



  getBlockTransactions(hash){
      return new Promise(async (resolve)=>{
          let block = this.getBlockFromDBByHash(hash);
          if(block){
              if(block.error) resolve({error:block.error})

              let transactions = block[block.hash]
              if(transactions.actions){
                  delete transactions.actions
              }

              resolve(transactions)
          }else{
              resolve(false)
          }
      })
  }

  getBlockActions(hash){
    return new Promise((resolve)=>{
        let block = this.getBodyFromDB(hash);
        if(block){
            if(block.error) resolve({error:block.error})

            let transactions = block[block.hash]
            if(transactions.actions){
                resolve(transactions.actions)
            }else{
                resolve(false)
            }
        }else{
            resolve(false)
        }
    })
}

  getTransactionFromDB(hash){
    return new Promise(async (resolve)=>{
      let transaction = {}
      for await(var block of this.chain){
        if(block.blockNumber > 0 ){
          if(block.txHashes){
            
            if(block.txHashes.includes(hash)){
              
              let body = await this.getBlockFromDB(block.blockNumber)
              if(body){
                transaction = body.transactions[hash];
              }else{
                resolve({error:`Found transaction in block ${block.blockNumber} but could not fetch its content`})
              }
            }
          }else{
            resolve({error:`Block ${block.blockNumber} has not transaction hashes`})
          }
        }

      }

      resolve(transaction)
    })
  }

  getActionFromDB(hash){
    return new Promise(async (resolve)=>{
      let lastBlock = this.getLatestBlock()
      let found = false;
      for await(var block of this.chain){
        if(block.blockNumber != 0){
          if(block.actionHashes){
            if(block.actionHashes.includes(hash)){
              let body = await this.getBlockFromDB(block.blockNumber)
              if(body){
                if(body.actions){
                  let action = body.actions[hash];
                  found = true
                  resolve(action)
                }else{
                  resolve({error:`ERROR: Body of block ${block.blockNumber} does not contain actions`})
                }
              }else{
                resolve({error:`ERROR: Body of block ${block.blockNumber} does not exist`})
              }
            }else{
              if(lastBlock.blockNumber == block.blockNumber && !found){
                resolve({error:'ERROR: Could not find anything for action '+ hash.substr(0, 10)})
              }
            }
          }else{
            resolve({error:`ERROR: Header ${block.blockNumber} does not have action hashes`})
          }
        }
      }
    })
  }
  


  selectNextPreviousBlock(){
    if(this.getLatestBlock().blockFork){
      let latestBlock = this.getLatestBlock();
      let blockFork = this.getLatestBlock().blockFork;
      if(blockFork.nonce > latestBlock.nonce){
        return blockFork;
      }else{
        return latestBlock;
      }
    }else{
      return this.getLatestBlock();
    }

  }

 /**
  * Calculates the total work done on the blockchain by adding all block
  * difficulties, parsed to BigInt from hex
  * @param {Blockchain} chain 
  * @return {string} Total difficulty of given blockchain, expressed as a hex string
  */
  calculateWorkDone(chain=this.chain){
    let total = BigInt(0);
    chain.forEach( block=>{
      let difficulty = BigInt(parseInt(block.difficulty, 16))
      total += difficulty;
    })

    return total.toString(16);
  }

  /***
   * Calculates the total work done on the blockchain by adding all block
  * difficulties, parsed to BigInt from hex
  * @param {Blockchain} chain 
  * @return {string} Total difficulty of given blockchain, expressed as a hex string 
   */

  async calculateTotalDifficulty(chain=this.chain){
     let total = BigInt(0);
     for await(let block of chain){
       let parseDifficulty = parseInt(block.difficulty, 16)
      let difficulty = BigInt(parseDifficulty)
      total += difficulty;
     }

     return total.toString(16)
   }

  /**
   * 
  * @param {object} transaction Unvalidated transaction object 
  * @return {boolean} Validity of transaction, or error object
  */
  createTransaction(transaction){
    return new Promise((resolve, reject)=>{
      this.validateTransaction(transaction)
      .then(valid =>{
        resolve(valid)
      })
      .catch(e =>{
        reject(e);
      })
      
    })
    
  }

  async chainHasBlockOfHash(hash){
    for await(let header of this.chain){
      if(header.hash == hash){
        return true
      }
    }

    return false
  }

  async getIndexOfBlockHashInChain(hash){
    for await(let header of this.chain){
      if(header.hash == hash){
        return header.blockNumber
      }
    }

    return false
  }

  checkIfChainHasHash(hash){
    for(var i=this.chain.length; i > 0; i--){
      if(this.chain[i-i].hash === hash){
        return true
      }
    }

    return false;
  }

  getIndexOfBlockHash(hash){
    for(var i=0; i < this.chain.length; i++){
      if(this.chain[i].hash === hash){
        return i;
      }
    }

    return false;
  }

  async getBlockNumberOfHash(hash){
    for await(let block of this.chain){
      if(block.hash == hash) return block.blockNumber
    }
    
    return false;
  }

  isBlockLinked(block){
    if(block){
      var lastBlock = this.getLatestBlock();
      if(lastBlock.hash == block.previousHash){
        return true;
      }
      
      return false;
    }
    
  }

  getBlockFromHash(hash){
    for(var i=0; i < this.chain.length; i++){
      if(this.chain[i].hash === hash){
        return this.chain[i];
      }
    }

    return false;
  }

  async getBlockbyHash(hash){
    for await(let block of this.chain){
      if(block.hash === hash) return block
    }

    return false;
  }

  async getNextBlockbyHash(hash){
    for await(let block of this.chain){
      if(block.previousHash === hash) return block
    }

    return false;
  }


  checkBalance(publicKey){
    let walletState = balance.getBalance(publicKey)
    if(walletState) return walletState.balance;
    else return 0
    
  }

  gatherMiningFees(transactions, actions){
    return new Promise((resolve)=>{
      if(transactions){
        let reward = 0;
        var txHashes = Object.keys(transactions);
        for(var hash of txHashes){
            reward += transactions[hash].miningFee;
        }
  
        if(actions){
          var actionHashes = Object.keys(transactions);
          for(var hash of actionHashes){
              reward += actions[hash].fee;
          }
        }
        resolve(reward)
      }else{
        resolve(false)
      }
    })

  }

  

  getMiningFees(block){
      return new Promise(async(resolve)=>{
        if(block){
            let reward = 0;
            let transactions = await this.getBlockTransactions(block.hash)
            if(transactions){
                if(transaction.error) resolve({error:transaction.error})
                transactions = transactions[transactions._id]
                var txHashes = Object.keys(transactions);
                var actionHashes = Object.keys(transactions.actions);
                
                for await(var hash of txHashes){
                    reward += transactions[hash].miningFee;
                }
        
                for await(var hash of actionHashes){
                    reward += transactions.actions[hash].fee;
                }
        
                resolve(reward)
            }else{
                resolve({error:`ERROR: Could not get mining fee, block ${block.hash} does not exist`})
            }
            
          }
      })

  }

  async calculateTotalMiningRewards(){
    let amountOfReward = 0;
    for await(let block of this.chain){
      let transactions = await this.getBlockTransactions(block.hash)
        if(transactions){
          if(transactions.error) return { error:transactions.error }
        }else{
          
          transactions = transactions[transactions._id]
          let txHashes = Object.keys(transactions);
          txHashes.forEach( hash =>{
            let tx = transactions[hash];
            if(tx.fromAddress == 'coinbase'){
              amountOfReward += tx.amount;
            }
          })
        }
    }

    return amountOfReward;
  }



  async getTransactionHistory(publicKey){
    if(publicKey){
      var address = publicKey;
      var history = {
        sent:{},
        received:{},
        pending:{
          sent:{},
          received:{}
        }
      }
      var trans;
      if(!publicKey){
        logger("ERROR: Can't get balance of undefined publickey")
        return false;
      }
        for await(var block of this.chain){
          let transactions = await this.getBlockTransactions(block.hash)
          if(transactions){
            if(transactions.error) return {error:transactions.error}
            transactions = transactions[transactions._id]
            for(var transHash of Object.keys(transactions)){
                trans = transactions[transHash]
                if(trans){
                  if(trans.fromAddress == address){
                      history.sent[trans.hash] = trans
                  }
                  if(trans.toAddress == address){
                      history.received[trans.hash] = trans;
                  }

                }

            }
          }else{
              return {error:`ERROR: Could not get transaction history. Block ${block.hash} not found`}
          }
          
        }

      return history;
    }

  }

  async getTransactionFromChain(hash){
    let tx = {}
    if(hash){
      for await(let block of this.chain){
        let transactions = await this.getBlockTransactions(block.hash)
        if(transactions){
            if(transactions.error) return {error:transactions.error}
            transactions = transactions[transactions._id]
            if(block.transactions[hash]){
                //need to avoid collision
                tx = block.transactions[hash];
                return tx;
            }
        }else{
            return {error:`ERROR: Could not find transaction ${hash}. \nBlock ${block.hash} not found`}
        }
        
      }

      return false
      
    }
  }

  /**
    Shows which block is conflicting
  */
  isChainValid(){
    for(let i=1;i < this.chain.length; i++){

      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      if(currentBlock.hash !== RecalculateHash(currentBlock)){
        console.log('*******************************************************************');
        console.log('currentblock hash does not match the recalculation ');
        console.log('Invalid block is :' + i + ' with hash: ' + currentBlock.hash + ' and previous hash: ' + previousBlock.hash);
        console.log('*******************************************************************');
        return {conflict:i};
      }else if(currentBlock.previousHash !== previousBlock.hash){
        console.log('*******************************************************************');
        console.log('* currentblock hash does not match previousblock hash *');
        console.log('Invalid block is :' + i + ' with hash: ' + currentBlock.hash + ' and previous hash: ' + previousBlock.hash);
        console.log('*******************************************************************');
        return {conflict:i};
      }
    }

    return true;
  }

  getTotalDifficulty(){
      let total = BigInt(1);

      this.chain.forEach( block=>{
        total += BigInt(parseInt(block.difficulty, 16))
      })

      return total.toString(16);
  }

  async getMedianBlockTimestamp(numBlocks){
    let currentBlockNumber = this.getLatestBlock().blockNumber
    let pastBlocks = this.chain.slice(currentBlockNumber - numBlocks, currentBlockNumber)
    let timestampSum = 0
    for await(let block of pastBlocks){
      timestampSum += block.timestamp
    }

    return timestampSum / numBlocks
  }

  async validateBlockTimestamp(block){
    let medianBlockTimestamp = 0
    if(this.chain.length > 10){
      medianBlockTimestamp = await this.getMedianBlockTimestamp(10)
    }else if(this.chain.length > 2){
      medianBlockTimestamp = await this.getMedianBlockTimestamp(this.chain.length - 1)
    }else{
      medianBlockTimestamp = this.chain[0].timestamp
    }

    
    let timestamp = block.timestamp;
    let twentyMinutesInTheFuture = 20 * 60 * 1000
    let previousBlock = this.chain[block.blockNumber - 1] || this.getLatestBlock()
    let previousTimestamp = previousBlock.timestamp
    if(timestamp > previousTimestamp && timestamp < (Date.now() + twentyMinutesInTheFuture) ){
      if(block.timestamp < medianBlockTimestamp) return false
      else return true
    }else{
      return false
    }
    
  }


  validateUniqueCoinbaseTx(block){
    return new Promise(async (resolve)=>{
      let transactionHashes = Object.keys(block.transactions);
      let coinbase = false
      for await(var hash of transactionHashes){
        let tx = block.transactions[hash]
        if(tx.fromAddress == 'coinbase'){
          if(!coinbase){
            coinbase = tx;
          }else{
            resolve(false)
          }
        }
      }

      resolve(coinbase)
    })
  }

  async validateEntireBlockchain(){
    logger('Validating the entire blockchain')
    for await(let header of this.chain){
      if(header.blockNumber > 0){
        logger('Validating block '+header.blockNumber)
        let block = await this.getBlockFromDB(header.blockNumber.toString())
        
        let isValidBlock = await this.isValidBlock(block)
        if(!isValidBlock) return { error: `Block number ${block.blockNumber} is not valid` }
      }
    }

    return true
  }


  /**
    Criterias for validation are as follows:
    - Block has successfully calculated a valid hash
    - Block linked with previous block by including previous hash in its own hash calculation
    - Total challenge score matches 
    - Chain doesn't already contain this block
    - Timestamp is greater than previous timestamp
    - All transactions are valid
    - No double spend took place in chain
    @param {string} $block - Block to be validated
  */
  async validateBlock(block){
      try{
        
        var areValidTx = await this.validateBlockTransactions(block)
        var isValidHash = block.hash == RecalculateHash(block);
        var singleCoinbase = await this.validateUniqueCoinbaseTx(block)
        var isValidConsensus = await this.consensus.validate(block)
        var coinbaseIsAttachedToBlock = this.coinbaseIsAttachedToBlock(singleCoinbase, block)
        var merkleRootIsValid = await this.isValidMerkleRoot(block.merkleRoot, block.transactions);
        var doesNotContainDoubleSpend = await this.blockDoesNotContainDoubleSpend(block)
      
        chainLog('All transactions are valid', (areValidTx? true:false))
        chainLog('Has a valid hash', isValidHash)
        chainLog('Has a single coinbase transaction', (singleCoinbase? true:false))
        chainLog('Meets the consensus rules', isValidConsensus)
        chainLog('Coinbase is linked to block', coinbaseIsAttachedToBlock)
        chainLog('Merkle root is valid', merkleRootIsValid)
        chainLog('Block does not contain double spend:', typeof doesNotContainDoubleSpend)

        if(areValidTx.error) return { error:areValidTx.error} 
        if(!isValidConsensus || isValidConsensus.error) return { error:(isValidConsensus ? isValidConsensus.error : 'ERROR: Block does not meet consensus requirements') }
        if(!coinbaseIsAttachedToBlock) return {error:'ERROR: Coinbase transaction is not attached to block '+block.blockNumber}
        if(!singleCoinbase) return {error:'ERROR: Block must contain only one coinbase transaction'}
        if(!merkleRootIsValid) return {error:'ERROR: Merkle root of block is not valid'}
        if(!isValidHash) return {error:'ERROR: Is not valid block hash'}
        if(!doesNotContainDoubleSpend) return { error:'ERROR: Block contains double spend' }
        
        return true
      }catch(e){
        return { error:e.message }
      }
  }

  async blockDoesNotContainDoubleSpend(block){
    let txHashes = Object.keys(block.transactions);
    let actionHashes = Object.keys(block.actions);

    

    for await(let hash of txHashes){
      let exists = this.spentTransactionHashes[hash]
      if(exists) return false
    }

    for await(let hash of actionHashes){
      let exists = this.spentActionHashes[hash]
      if(exists) return false
    }

    return true

  }


  /**
    @desc Useful for sync requests
    @param {string} $blockNumber - Index of block
  */

  getBlockHeader(blockNumber){
    if(typeof blockNumber == 'number' && blockNumber >= 0){

      var block = this.chain[blockNumber];

      if(block){
        
        var header = {
          blockNumber:block.blockNumber,
          timestamp:block.timestamp,
          previousHash:block.previousHash,
          hash:block.hash,
          nonce:block.nonce,
          merkleRoot:block.merkleRoot,
          actionMerkleRoot:block.actionMerkleRoot,
          difficulty:block.difficulty,
          totalDifficulty:block.totalDifficulty,
          challenge:block.challenge,
          txHashes:Object.keys(block.transactions),
          minedBy:block.minedBy,
          signatures:block.signatures
        }

        if(block.actions){
          header.actionHashes = Object.keys(block.actions)
        }

        return header
      }

    }

  }

  extractHeader(block){
    var header = {
      blockNumber:block.blockNumber,
      timestamp:block.timestamp,
      previousHash:block.previousHash,
      hash:block.hash,
      nonce:block.nonce,
      merkleRoot:block.merkleRoot,
      actionMerkleRoot:block.actionMerkleRoot,
      difficulty:block.difficulty,
      totalDifficulty:block.totalDifficulty,
      challenge:block.challenge,
      txHashes:(block.transactions? Object.keys(block.transactions) : []),
      actionHashes:(block.actions ? Object.keys(block.actions):[]),
      minedBy:block.minedBy,
      signatures:block.signatures
    }

    if(block.actions){
      header.actionHashes = Object.keys(block.actions)
    }

    return header
  }

  getAllHeaders(){
      try{
        var headers = []
          this.chain.forEach( block => headers.push(this.getBlockHeader(block.blockNumber)) )
          return headers
      }catch(e){
        console.log('GET HEADER ERROR:', e)
      }
    
  }

  async validateBlockHeader(header){
    if(isValidHeaderJSON(header)){
      
      let isValidHash = header.hash === RecalculateHash(header)
      chainLog('Header has a valid hash', isValidHash)
      if(!isValidHash){
        console.log('Invalid hash')
        return false;
      }

      let hasValidTimestamp = await this.validateBlockTimestamp(header)
      chainLog('Header has a valid timestamp', hasValidTimestamp)
      if(!hasValidTimestamp) console.log('Invalid timestamp:', hasValidTimestamp)

      var chainAlreadyContainsBlock = await this.getBlockbyHash(header.hash);
      chainLog('Block header already in chain:', typeof chainAlreadyContainsBlock)
      if(chainAlreadyContainsBlock) return false
      
      return true
      
    }else return false;
  }

  validateBlockchain(allowRollback){
    
      let isValid = this.isChainValid();
      if(isValid.conflict){
        let atBlockNumber = isValid.conflict;
        //Need to replace with side chain algorithm
        if(allowRollback){
          this.rollbackToBlock(atBlockNumber-1);
          logger('Rolled back chain up to block number ', atBlockNumber-1)
          return true;
        }else{
          return false;
        }
      }

      return true;
  }

  rollbackToBlock(number, contractTable){
    return new Promise(async (resolve)=>{

      const collectActionHashes = async (blocks) =>{
        return new Promise(async (resolve)=>{
          let actionHashes = []
          for(var block of blocks){
            if(block.actionHashes){
              actionHashes = [  ...actionHashes, ...block.actionHashes ]
            }
          }
          chainLog(`Collected ${actionHashes.length} action hashes`)
          resolve(actionHashes)
        })
      }

      const collectTransactionHashes = async (blocks) =>{
        return new Promise(async (resolve)=>{
          let txHashes = []
          
          for(var block of blocks){
            if(block.txHashes){
              
              txHashes = [  ...txHashes, ...block.txHashes ]
            }
          }
          chainLog(`Collected ${txHashes.length} transaction hashes`)
          resolve(txHashes)
        })
      }

      let errors = {}
      let totalBlockNumber = this.chain.length
      
      if(number < 0) number = 0
      let startNumber = ( typeof number == 'number' ? number : parseInt(number)  )
      chainLog(`Start removing blocks at ${startNumber}`)
      
      let newLastBlock = this.chain[number];
      let numberOfBlocksToRemove = totalBlockNumber - number;
      chainLog(`Number of blocks to remove: ${numberOfBlocksToRemove}`)
      
      //Getting a copy of the blocks that will later be removed from the chain
      
      let blocks = this.chain.slice(startNumber + 1, this.chain.length)
      chainLog(`Took a copy of the last ${blocks.length} of the header chain`)

      let newestToOldestBlocks = blocks.reverse()
      let actionHashes = await collectActionHashes(newestToOldestBlocks)
      let txHashes = await collectTransactionHashes(newestToOldestBlocks)

      for await(let hash of txHashes){
        if(this.spentTransactionHashes[hash]) delete this.spentTransactionHashes[hash]
      }
      chainLog(`Unspent ${txHashes.length} transaction hashes`)

      for await(let hash of actionHashes){
        if(this.spentActionHashes[hash]) delete this.spentActionHashes[hash]
      }
      chainLog(`Unspent ${actionHashes.length} action hashes`)

    if(actionHashes.length > 0){
      chainLog(`Found some action hashes!`)
      for await(var hash of actionHashes){
        //Rolling back actions and contracts
        let action = await this.getActionFromDB(hash);
        chainLog(`Rolling back action hash ${action.hash.substr(0, 15)}...`)
        if(action){
          
            if(action.error){
              chainLog(`Error occurred while fetching action: ${action.error}`)
              resolve({error:action.error})
            }
            else{
              if(action.type == 'contract' && action.task == 'deploy'){
                chainLog(`Action is of type contract deploy`)
                let contractName = action.data.name;
                let deleted = await contractTable.removeContract(contractName);
                chainLog(`Removed contract ${contractName}: `, deleted)
                if(deleted.error) resolve({ error:deleted.error })

              }else if(action.type == 'account' && action.task == 'create'){

                let account = action.data
                let removed = await accountTable.deleteAccount({ name:account.name, action:action });
                chainLog(`Removed account ${account.name}: `, removed)
                if(removed.error) resolve({ error:removed.error })

              }
            }
          }
        }
      }

      let backToNormal = newestToOldestBlocks.reverse()
      let removed = this.chain.splice(startNumber + 1, numberOfBlocksToRemove)
      chainLog(`Header chain is now ${this.chain.length} blocks long`)

      let stateRolledBack = await contractTable.rollback(number)
      chainLog(`Rolled back state of contracts to block ${number}`, stateRolledBack)
      if(stateRolledBack.error) resolve({error:stateRolledBack.error})

      let lastBlock = this.getLatestBlock()
      chainLog(`Last block is block ${lastBlock.blockNumber} of hash ${lastBlock.hash.substr(0, 15)}...`)

      let rolledBack = await balance.rollback(lastBlock.blockNumber.toString())
      chainLog(`Rolled back balance states to block ${lastBlock.blockNumber}`, rolledBack)
      if(rolledBack.error) resolve({error:rolledBack.error})

      for await(let header of removed){
        let deleted = await this.chainDB.deleteId(header.blockNumber.toString())
        chainLog(`Removed block ${header.blockNumber} from DB`, deleted)
        if(deleted.error) resolve(deleted.error)
      }

      await this.createNewSnapshot()
      logger('Rolled back to block ', number)
      if(Object.keys(errors).length > 0) resolve({error:errors})
      else{
        resolve({ rolledback:true })
      }
    })
  }
  

  validateBlockTransactions(block){
    return new Promise(async (resolve, reject)=>{
      if(isValidBlockJSON(block)){
        let txHashes = Object.keys(block.transactions);
        let errors = {}
        for await (let hash of txHashes){
          let transaction = block.transactions[hash];
          let valid = await this.validateTransaction(transaction);
          if(valid.error) resolve({ error:valid.error })
        }
        if(Object.keys(errors).length > 0) resolve({error:errors})
        else resolve(block);
      }else{
        resolve({error:'ERROR: Must pass block object'})
      }
      
    })
  }
  //Redundant with the above method ^
  validateTransactionsOfBlock(block){
    return new Promise(async (resolve, reject)=>{
      let txHashes = Object.keys(block.transactions);
        let errors = {}
        for await (let hash of txHashes){
          let transaction = block.transactions[hash];
          let valid = await this.validateTransaction(transaction);
          if(valid.error) errors[hash] = valid.error
        }
        if(Object.keys(errors).length > 0) resolve({error:errors})
        else resolve(block);
      
    })
  }

  async validateTransactionsBeforeMining(transactions){
    let rejectedTransactions = {}
    let acceptedTransactions = {}

    for await(let hash of Object.keys(transactions)){
      let transaction = transactions[hash]

      let isValid = await this.validateTransaction(transaction);
      if(isValid && !isValid.error){  
        let alreadyExistsInBlockchain = this.spentTransactionHashes[hash]
        if(!alreadyExistsInBlockchain) acceptedTransactions[hash] = transaction
        else rejectedTransactions[hash] = transaction
      }else{
        rejectedTransactions[hash] = transaction
      }
      
    }

    if(Object.keys(rejectedTransactions).length >0){
      let deleted = await mempool.deleteTransactionsOfBlock(rejectedTransactions);
      if(deleted.error) return { error:deleted.error }
    }

    return acceptedTransactions
  }

  async validateActionsBeforeMining(actions){
    let rejectedActions = {}
    let acceptedActions = {}

    for await(let hash of Object.keys(actions)){
      let action = actions[hash]

      let isValid = await this.validateAction(action);
      if(isValid && !isValid.error){
        let alreadyExistsInBlockchain = this.spentActionHashes[hash]
        if(!alreadyExistsInBlockchain){
          acceptedActions[hash] = action
        }else{
          rejectedActions[hash] = action
        }
      }else{
        rejectedActions[hash] = action
      }
      
    }

    if(Object.keys(rejectedActions).length > 0){
      let deleted = await mempool.deleteActionsOfBlock(actions)
      if(deleted.error) return { error:deleted.error }
    }

    return acceptedActions
  }



  coinbaseIsAttachedToBlock(transaction, block){
    if(block.coinbaseTransactionHash === transaction.hash){
      return true
    }else{
      return false
    }
  }
  
  blockContainsOnlyValidTransactions(block){
    return new Promise(async (resolve, reject)=>{
      if(isValidBlockJSON(block)){
        let txHashes = Object.keys(block.transactions);
        let errors = {}
        for await (let hash of txHashes){
          let transaction = block.transactions[hash];
          let valid = await this.validateTransaction(transaction);
          if(valid.error) errors[hash] = valid.error
        }
        if(Object.keys(errors).length > 0) resolve({error:errors})
        else resolve(true);
      }else{
        resolve({error:'ERROR: Must pass block object'})
      }
      
    })
  }

  recalculateMerkleRoot(block){
    if(isValidBlockJSON(block)){
      let recalculatedMerkleRoot = merkleRoot(block.transactions);
      if(recalculatedMerkleRoot == block.merkleRoot){
        return true;
      }else{
        return false;
      }
    }else{
      return false;
    }
   
  }

  isValidMerkleRoot(root, transactions){
      if(transactions && root){
        let recalculatedMerkleRoot = merkleRoot(transactions);
        if(recalculatedMerkleRoot == root){
            return true;
        }else{
            console.log('Root:', root)
            console.log('Recalculated:', recalculatedMerkleRoot)
            console.log('Transaction', transactions)
            return false;
        }
      }else{
        return false;
      }
    
  }


    /**
  *  To run a proper transaction validation, one must look back at all the previous transactions that have been made by
  *  emitting peer every time this is checked, to avoid double spending. An initial coin distribution is made once the genesis
  *  block has been made. This needs some work since it is easy to send a false transaction and accumulate credits
  *
  * @param {Object} $transaction - transaction to be validated
  * @param {function} $callback - Sends back the validity of the transaction
  */

 async validateTransaction(transaction){
  return new Promise(async (resolve)=>{
    if(transaction){
      try{
        
        var isMiningReward = transaction.fromAddress == 'coinbase';
        var isTransactionCall = transaction.type == 'call'
        var isStake = transaction.type == 'stake'
        var isResourceAllocation = transaction.type == 'allocation'
        var isPayable = transaction.type == 'payable'

        let alreadyExistsInBlockchain = this.spentTransactionHashes[transaction.hash]
        if(alreadyExistsInBlockchain) resolve({error:'Transaction already exists in blockchain'})

        if(isTransactionCall){

          let isValidTransactionCall = await this.validateTransactionCall(transaction);
          if(isValidTransactionCall.error) resolve({error:isValidTransactionCall.error})
          else resolve(isValidTransactionCall)


        }else if(isMiningReward){
          
          let isValidCoinbaseTransaction = await this.validateCoinbaseTransaction(transaction)

          if(isValidCoinbaseTransaction.error) resolve({error:isValidCoinbaseTransaction.error})

          if(isValidCoinbaseTransaction && !isValidCoinbaseTransaction.error){
            resolve(true)
          }

        }else if(isPayable){
          
          let isValidPayable = await this.validatePayable(transaction)
          resolve(isValidPayable)

        }else if(isStake){
          //validateStakeTransaction

        }else if(isResourceAllocation){
          //validateAllocationTransaction

        }else {

          let isValidTransaction = await this.validateSimpleTransaction(transaction)
          if(isValidTransaction.error) resolve({error:isValidTransaction.error})
          else resolve(isValidTransaction)
        }
        
      }catch(err){
        resolve({error:'ERROR: an error occured'})
      }

    }else{
      resolve({error:'ERROR: Transaction is undefined'})
    }

  })
  

}

  validateSimpleTransaction(transaction){
    return new Promise(async (resolve)=>{
      if(isValidTransactionJSON(transaction)){
        
        let fromAddress = transaction.fromAddress;
        let toAddress = transaction.toAddress;

        let fromAddressIsAccount = await accountTable.getAccount(fromAddress);
        let toAddressIsAccount = await accountTable.getAccount(toAddress);

        if(fromAddressIsAccount){
          fromAddress = fromAddressIsAccount.ownerKey
        }
        if(toAddressIsAccount){
          toAddress = toAddressIsAccount.ownerKey
        }
        
        var isChecksumValid = this.validateChecksum(transaction);
        if(!isChecksumValid) resolve({error:'REJECTED: Transaction checksum is invalid'});

        let isSendingAddressValid = await validatePublicKey(fromAddress)
        let isReceivingAddressValid = await validatePublicKey(toAddress)

        if(isSendingAddressValid && isReceivingAddressValid){

          let isSignatureValid = await this.validateSignature(transaction, fromAddress);
          if(!isSignatureValid) resolve({error:'REJECTED: Transaction signature is invalid'});

          let isNotCircular = fromAddress !== toAddress;
          if(!isNotCircular) resolve({error:"REJECTED: Sending address can't be the same as receiving address"});

          var balanceOfSendingAddr = await this.checkBalance(fromAddress)
          let hasEnoughFunds = balanceOfSendingAddr >= transaction.amount + transaction.miningFee
          if(!hasEnoughFunds) resolve({error:'REJECTED: Sender does not have sufficient funds'});
          
          var amountIsNotZero = transaction.amount > 0;
          if(!amountIsNotZero) resolve({error:'REJECTED: Amount needs to be higher than zero'});

          let hasMiningFee = transaction.miningFee >= this.calculateTransactionMiningFee(transaction); //check size and fee
          if(!hasMiningFee) resolve({error:"REJECTED: Mining fee is insufficient"});

          var transactionSizeIsNotTooBig = Transaction.getTransactionSize(transaction) < this.transactionSizeLimit //10 Kbytes
          if(!transactionSizeIsNotTooBig) resolve({error:'REJECTED: Transaction size is above 10KB'});

          resolve(true)

        }else if(!isReceivingAddressValid){

          resolve({error:'REJECTED: Receiving address is invalid'});
        }else if(!isSendingAddressValid){
          resolve({error:'REJECTED: Sending address is invalid'});
        }
      }else{
        resolve({error:`ERROR: Transaction has an invalid format`})
      }
    })
  }

  async validateTransactionCall(transaction){
    return new Promise(async (resolve, reject)=>{
      if(transaction){
        try{

            let fromAccount = await accountTable.getAccount(transaction.fromAddress)
            if(!fromAccount) resolve({error:`REJECTED: Sending account ${transaction.fromAddress} is unknown`});
            else{

              let isSignatureValid = await this.validateActionSignature(transaction, fromAccount.ownerKey)
              let toAccount = await accountTable.getAccount(transaction.toAddress) //Check if is contract
              let toAccountIsContract = await this.contractDB.get(transaction.toAddress)
              var isChecksumValid = this.validateChecksum(transaction);
              var amountHigherOrEqualToZero = transaction.amount >= 0;
              let hasMiningFee = transaction.miningFee >= this.calculateTransactionMiningFee(transaction); //check size and fee 
              var transactionSizeIsNotTooBig = Transaction.getTransactionSize(transaction) < this.transactionSizeLimit //10 Kbytes
              let isNotCircular = fromAccount.name !== toAccount.name
              var balanceOfSendingAddr = await this.checkBalance(fromAccount.ownerKey) //+ this.checkFundsThroughPendingTransactions(transaction.fromAddress);
              let hasEnoughFunds = balanceOfSendingAddr >= transaction.amount + transaction.miningFee

              if(!toAccount) resolve({error:`REJECTED: Receiving account ${transaction.toAddress} is unknown`});
              if(!isChecksumValid) resolve({error:'REJECTED: Transaction checksum is invalid'});
              if(!amountHigherOrEqualToZero) resolve({error:'REJECTED: Amount needs to be higher than or equal to zero'});
              if(!hasMiningFee) resolve({error:"REJECTED: Mining fee is insufficient"});
              if(!transactionSizeIsNotTooBig) resolve({error:'REJECTED: Transaction size is above 10KB'});
              if(!isSignatureValid) resolve({error:'REJECTED: Transaction signature is invalid'});
              if(!toAccountIsContract) resolve({error: 'REJECTED: Transaction calls must be made to contract accounts'})
              if(!isNotCircular) resolve({error:"REJECTED: Sending account can't be the same as receiving account"}); 
              if(!hasEnoughFunds) resolve({error: 'REJECTED: Sender does not have sufficient funds'})

            }
            

            resolve(true)

        }catch(err){
          resolve({error:err.message})
        }
  
      }else{
        logger('ERROR: Transaction is undefined');
        resolve({error:'ERROR: Transaction is undefined'})
      }
  
    })
    

  }

  async validatePayable(transaction){
    return new Promise(async (resolve, reject)=>{
      if(transaction){
        try{
          
            let fromAccount = await accountTable.getAccount(transaction.fromAddress)
            if(!fromAccount) resolve({error:`REJECTED: Sending account ${transaction.fromAddress} is unknown`});
            else{

              let isSignatureValid = await this.validateActionSignature(transaction.reference, fromAccount.ownerKey)
              let toAccount = await accountTable.getAccount(transaction.toAddress) 
              let contractAccount = await accountTable.getAccount(transaction.fromContract)
              let fromContract = contractAccount.type == 'contract'
              var isChecksumValid = this.validateChecksum(transaction);
              var amountHigherOrEqualToZero = transaction.amount >= 0;
              let hasMiningFee = true//transaction.miningFee >= this.calculateTransactionMiningFee(transaction); //check size and fee 
              var transactionSizeIsNotTooBig = Transaction.getTransactionSize(transaction) < this.transactionSizeLimit //10 Kbytes
              let isNotCircular = fromAccount.name !== toAccount.name
              var balanceOfSendingAddr = await this.checkBalance(fromAccount.ownerKey) //+ this.checkFundsThroughPendingTransactions(transaction.fromAddress);
              let hasEnoughFunds = balanceOfSendingAddr >= transaction.amount + transaction.miningFee
              let hasValidReference = await this.validatePayableReference(transaction.reference, transaction, fromAccount, fromContract)

              if(!toAccount) resolve({error:`REJECTED: Receiving account ${transaction.toAddress} is unknown`});
              if(!isChecksumValid) resolve({error:'REJECTED: Transaction checksum is invalid'});
              if(!amountHigherOrEqualToZero) resolve({error:'REJECTED: Amount needs to be higher than or equal to zero'});
              if(!hasMiningFee) resolve({error:"REJECTED: Mining fee is insufficient"});
              if(!transactionSizeIsNotTooBig) resolve({error:'REJECTED: Transaction size is above 10KB'});
              if(!isSignatureValid) resolve({error:'REJECTED: Payable reference signature is invalid'});
              if(!contractAccount || !contractAccount.type !=='contract' || fromContract.error) resolve({error: 'REJECTED: Payable must be made within contract calls'})
              if(!isNotCircular) resolve({error:"REJECTED: Sending account can't be the same as receiving account"}); 
              if(!hasEnoughFunds) resolve({error: 'REJECTED: Sender does not have sufficient funds'})
              if(hasValidReference.error) resolve({error:hasValidReference.error})

            }
            

            resolve(true)

        }catch(err){
          resolve({error:err.message})
        }
  
      }else{
        logger('ERROR: Transaction is undefined');
        resolve({error:'ERROR: Transaction is undefined'})
      }
  
    })
    

  }

  async validatePayableReference(reference, transaction, sendingAccount, fromContract){
    try{
      // let isValidTransaction = await this.validateTransactionCall(reference);
      // let isValidAction = await this.validateAction(reference)

      // if(isValidTransaction.error && isValidAction.error) return { error:'ERROR: Reference is not a valid transaction call or action' }
  
      let fromAccount = await accountTable.getAccount(reference.fromAddress)
      if(!fromAccount || fromAccount.error) return { error:`ERROR: Could not find account ${reference.fromAddress} of payable reference` }

      let isSameAddress = fromAccount.name === sendingAccount.name && fromAccount.ownerKey === sendingAccount.ownerKey
      if(!isSameAddress) return { error:'ERROR: Payables must be sent by the same account who sent the reference' }

      let isSignatureValid = await this.validateActionSignature(reference, fromAccount.ownerKey)
      if(!isSignatureValid) return { error:'ERROR: Payable reference signature is not valid' }

      let referenceContract = await this.contractDB.get(reference.toAddress)
      
      if(!referenceContract || referenceContract.error) return { error:'ERROR: Payable reference must be made to contract account' }

      let contractAPI = referenceContract.contractAPI
      let method = contractAPI[reference.data.method]
      let referenceEmitsPayable = method.emits === 'Payable'
      if(!referenceEmitsPayable) return { error:'ERROR: Invoked contract method must emit payable' }

      let wasAlreadyUsed = this.spentTransactionHashes[reference.hash].referenceTo
      if(wasAlreadyUsed) return { error:`ERROR: Transaction ${reference.hash.substr(0,10)}... is already a reference` }

      let isSameContract = reference.toAddress === transaction.fromContract
      if(!isSameContract) return { error:'ERROR: Payable reference must be sent to same contract as payable' }

      return true
    }catch(e){
      return { error:e.message }
    }
  }


  async validateCoinbaseTransaction(transaction, block){
    return new Promise(async (resolve, reject)=>{
      if(transaction && transaction.blockNumber){

        try{
          
          let isChecksumValid = this.validateChecksum(transaction);
          let hasTheRightMiningRewardAmount = transaction.amount <= (this.miningReward);
          let transactionSizeIsNotTooBig = Transaction.getTransactionSize(transaction) < this.transactionSizeLimit //10 Kbytes
                  
          if(!isChecksumValid) resolve({error:'REJECTED: Transaction checksum is invalid'});
          if(!hasTheRightMiningRewardAmount) resolve({error:'REJECTED: Coinbase transaction does not contain the right mining reward: '+ transaction.amount});
          if(!transactionSizeIsNotTooBig) resolve({error:'COINBASE TX REJECTED: Transaction size is above '+this.transactionSizeLimit+'Kb'});
          
          resolve(true)
              
        }catch(err){
          resolve({error:err.message})
        }
  
      }else{
        resolve({error:'ERROR: Coinbase transaction is undefined'})
      }
  
    }) 
  }

  

  

  
  // validateContractAction(action){
  //   return new Promise(async (resolve, reject)=>{
  //     if(action){
  //         let account = await accountTable.getAccount(action.fromAccount)
          

  //         let isExistingAccount = ( account? true : false )
  //         let isChecksumValid = await this.validateActionChecksum(action);
  //         let actionIsNotTooBig = (Transaction.getTransactionSize(action) / 1024) < this.transactionSizeLimit;
  //         let isLinkedToWallet = validatePublicKey(account.ownerKey);
          
  //         if(!hasValidActionRef) resolve({error:'ERROR: Invalid action reference passed'})
  //         if(!isExistingAccount) resolve({error:'ERROR: Account does not exist'})
  //         if(!isChecksumValid) resolve({error:"ERROR: Action checksum is invalid"})
  //         if(!isLinkedToWallet) resolve({error:"ERROR: Action ownerKey is invalid"})
  //         if(!actionIsNotTooBig) resolve({error:'ERROR: Action size is above '+this.transactionSizeLimit+'Kb'})
          
  //         resolve(true);

  //     }else{
  //       resolve({error:'Account or Action is undefined'})
  //     }
      
      
  //   })
    
  // }

  validateAction(action){
    return new Promise(async (resolve, reject)=>{
      if(action){
          let isCreateAccount = action.type == 'account' && action.task == 'create';
          let account = await accountTable.getAccount(action.fromAccount)
          
          if(isCreateAccount){

            if(account) resolve({error:'An account with that name already exists'})
            let newAccount = action.data;
            let isValidAccount = isValidAccountJSON(newAccount);

            if(!isValidAccount) resolve({error:"ERROR: Account contained in create account action is invalid"})

            account = newAccount;
          }

          let isExistingAccount = ( account? true : false )
          let isChecksumValid = await this.validateActionChecksum(action);
          let hasMiningFee = action.fee > 0; //check if amount is correct
          let actionIsNotTooBig = (Transaction.getTransactionSize(action) / 1024) < this.transactionSizeLimit;
          let balanceOfSendingAddr = await this.checkBalance(account.ownerKey)// + this.checkFundsThroughPendingTransactions(action.fromAccount.ownerKey);
          let isLinkedToWallet = validatePublicKey(account.ownerKey);
          let isSignatureValid = await this.validateActionSignature(action, account.ownerKey);

          if(!isExistingAccount) resolve({error:'ERROR: Account does not exist'})
          if(balanceOfSendingAddr < action.fee) resolve({error:"ERROR: Sender's balance is too low"})
          if(!isSignatureValid) resolve({error:"ERROR: Action signature is invalid"})
          if(!isChecksumValid) resolve({error:"ERROR: Action checksum is invalid"})
          if(!isLinkedToWallet) resolve({error:"ERROR: Action ownerKey is invalid"})
          if(!actionIsNotTooBig) resolve({error:'ERROR: Action size is above '+this.transactionSizeLimit+'Kb'})
          if(!hasMiningFee) resolve({error:'ERROR: Action needs to contain mining fee propertional to its size'})

          resolve(true);

      }else{
        resolve({error:'Account or Action is undefined'})
      }
      
      
    })
    
  }

  validateActionReference(actionReference, contractAction){
    return new Promise(async (resolve)=>{
      let contractName = actionReference.data.contractName
      let referenceExists = false
      for await(let block of this.chain){
        referenceExists = block.txHashes[hash]
        if(!referenceExists){
          referenceExists = block.actionHashes[hash]
        }
      }
      let contract = await this.contractDB.get(contractName)
      resolve({error:`ERROR: Contract ${contractName} does exist`})
      
      let contractAPI = contract.contractAPI;
      resolve({error:`ERROR: Contract ${contractName} does not have an API`})

      let contractMethod = contractAPI[actionReference.data.method];
      resolve({error:`ERROR: Contract method ${actionReference.data.method} does not exist`})

      let pointsToCorrectMethod = contractMethod.returns == 'contract action';
      resolve({error:`ERROR: Action reference does not point to method returning a contract action`})

       
      /**
       * Todo:
       * add a returns field to contractAPIs
       * 
       * Logic:
       * ---> send action calling method that returns contract action
       * <--- sends contract action, linking action as reference
       *      for all references:
       *        - validate if original action is linked to contract action
       *        - validate action content
       *  Mine contract action and execute
       * ***********************************
       * If block contains contract action:
       * - check action reference to see if exists
       * - check if already used before
       * - check if reference points to valid method
       * 
       *
       * 
       */
    })
  }

  validateContractAction(action, account){
    return new Promise(async (resolve, reject)=>{
      if(action){
          //Is linked to calling action
          //Is calling action actually calling contract
          let isChecksumValid = await this.validateActionChecksum(action);
          let hasMiningFee = action.fee > 0; //check if amount is correct
          let actionIsNotTooBig = Transaction.getTransactionSize(action) < this.transactionSizeLimit;
          let balanceOfSendingAddr = await this.checkBalance(action.fromAccount.ownerKey)// + this.checkFundsThroughPendingTransactions(action.fromAccount.ownerKey);
          let sendingAcccount = await accountTable.getAccount(action.fromAccount)
          let isLinkedToWallet = await validatePublicKey(sendingAcccount.ownerKey);
          let references = action.actionReference;
          
          

        if(balanceOfSendingAddr < action.fee){
          resolve({error:"ERROR: Sender's balance is too low"})
        }

        if(!isSignatureValid){
          resolve({error:"ERROR: Action signature is invalid"})
        }

        if(!isChecksumValid){
          resolve({error:"ERROR: Action checksum is invalid"})
        }

        if(!isLinkedToWallet){
          resolve({error:"ERROR: Action ownerKey is invalid"})
        }

        if(!actionIsNotTooBig){
          resolve({error:'ERROR: Action size is above '+this.transactionSizeLimit+'Kb'})
        }
  
        if(!hasMiningFee){
          resolve({error:'ERROR: Action needs to contain mining fee propertional to its size'})
        }

        resolve(true);

      }else{
        resolve({error:'Account or Action is undefined'})
      }
      
      
    })
    
  }

  /**
    Checks if the transaction hash matches it content
    @param {object} $transaction - Transaction to be inspected
    @return {boolean} Checksum is valid or not
  */
  validateChecksum(transaction){
    if(transaction){
       if(sha256(
                transaction.fromAddress+ 
                transaction.toAddress+ 
                (transaction.amount == 0 ? '0' : transaction.amount.toString())+ 
                (typeof transaction.data == 'string' ? transaction.data : JSON.stringify(transaction.data))+ 
                transaction.timestamp.toString()+
                transaction.nonce.toString()
                ) === transaction.hash){
        return true;
      }
    }
    return false;
  }

  /**
    Checks if the action hash matches its content
    @param {object} $action - Action to be inspected
    @return {boolean} Checksum is valid or not
  */
  validateActionChecksum(action){
    if(action){
      if(sha256(
                action.fromAccount + 
                action.type + 
                action.task + 
                action.data + 
                action.fee + 
                action.timestamp
                ) == action.hash){
       return true
      }else{
        return false;
      }
    }
  }

  /**
    Checks the validity of the transaction signature
    @param {object} $transaction - Transaction to be inspected
    @return {boolean} Signature is valid or not
  */
  validateSignature(transaction, fromAddress){
    return new Promise(async (resolve, reject)=>{
      if(transaction){
        if(validatePublicKey(fromAddress)){
          const publicKey = await ECDSA.fromCompressedPublicKey(fromAddress);
          if(publicKey){
            const verified = await publicKey.verify(transaction.hash, transaction.signature)
            resolve(verified)
          }else{
            resolve(false)
          }
          
        }else{
          resolve(false)
        }
      }else{
        resolve(false);
      }
    })
  }


  /**
    Checks the validity of the action signature
    @param {object} $action - Action to be inspected
    @param {object} $ownerKey - Public key of the owner account
    @return {boolean} Signature is valid or not
  */
  validateActionSignature(action, ownerKey){
    return new Promise(async (resolve, reject)=>{
      if(action && ownerKey && (isValidActionJSON(action) || isValidTransactionJSON(action))){
        if(validatePublicKey(ownerKey)){
          const publicKey = await ECDSA.fromCompressedPublicKey(ownerKey);
          if(publicKey){
            const verified = await publicKey.verify(action.hash, action.signature)
            resolve(verified)
          }else{
            resolve(false)
          }
          
        }else{
          resolve(false)
        }
      }else{
        resolve(false);
      }
    })
  }

   /**
    Sets the transaction's mining fee based on file size
    @param {object} $transaction - Transaction to be inspected
    @return {number} Amount to be payed upon mining
  */
  calculateTransactionMiningFee(transaction){
    let transactionBeforeSignature = {
      fromAddress:transaction.fromAddress,
      toAddress:transaction.toAddress,
      type:transaction.type,
      data:transaction.data,
      timestamp:transaction.timestamp
    }

    let size = Transaction.getTransactionSize(transactionBeforeSignature);
    
    let sizeFee = size * 0.0001;
    return sizeFee;
  }

  /**
    Determine whether a coinbase transaction is linked to a block
    @param {object} $transaction - Transaction to be inspected
    @return {object} Block to which the coinbase transaction is linked
  */
  coinbaseTxIsAttachedToBlock(transaction, block){
    if(block.coinbaseTransactionHash === transaction.hash){
      return true
    }else{
      return false
    }
    
    
  }

  /**
   * Keeps a trace of the top most recent blocks and their link to previous blocks
   * @param {Block} newBlock 
   */
  async manageChainSnapshotQueue(newBlock){
    try{
      if(newBlock){
        let maxNumberOfHashes = 10;
  
        this.chainSnapshot[newBlock.hash] = {
          blockNumber:newBlock.blockNumber,
          previousHash:newBlock.previousHash,
          difficulty:newBlock.difficulty,
          totalDifficulty:newBlock.totalDifficulty
        }
        
        let elements = Object.keys(this.chainSnapshot)
        if(elements.length > maxNumberOfHashes){
          let firstHash =  elements[0]
          delete this.chainSnapshot[firstHash]
          
        }
      }else{
        await this.createNewSnapshot()
        
      }
    }catch(e){
      return e.message
    }
  }

    /**
   * Keeps a trace of the top most recent blocks and their link to previous blocks
   *  
   */
  async createNewSnapshot(){
    try{
      let maxNumberOfHashes = 10;
      let blockNumber = this.getLatestBlock().blockNumber
      this.chainSnapshot = {}
      for(var i=blockNumber - 10; i  <= blockNumber; i++){
        let newBlock = this.chain[i]
        let maxNumberOfHashes = 10;

        this.chainSnapshot[newBlock.hash] = {
          blockNumber:newBlock.blockNumber,
          previousHash:newBlock.previousHash,
          difficulty:newBlock.difficulty,
          totalDifficulty:newBlock.totalDifficulty
        }
        
        let elements = Object.keys(this.chainSnapshot)
        if(elements.length > maxNumberOfHashes){
          let firstHash =  elements[0]
          delete this.chainSnapshot[firstHash]
          
        }
      }
    }catch(e){
      return e.message
    }

  }

    /**
    Fetches a block from chainDB
    @param {string} $blockNumberString - Block number is converted to string before making query
    @return {Promive<Block>} Block queried or error if is not found
  */
  getGenesisBlockFromDB(){
    return new Promise(async(resolve)=>{
      let genesisBlockEntry = await this.chainDB.get('0')
      if(genesisBlockEntry){
          if(genesisBlockEntry.error) resolve({error:genesisBlockEntry.error})
          
          resolve(genesisBlockEntry)
      }else{
          resolve(false)
      }
      
    })
    
  }


  /**
    Inits the blockchain by, first, fetching the last block/last state store in a JSON file
    Then, if loaded, will download the entirety of the blockchain from database
    Then will load balance state table
    @return {Promise} Success or failure
  */
  init(){
    return new Promise(async (resolve, reject)=>{
      logger('Loading all blocks. Please wait...')
      try{
        this.isLoadingBlocks = true
        let loaded = await this.loadBlocks()
        this.isLoadingBlocks = false
        if(loaded){
          let savedBalances = await balance.loadBalances(this.getLatestBlock().blockNumber)
          if(savedBalances.error){
            reject(savedBalances.error)
          }else{
            resolve(savedBalances)
          }
          
        }else{
          reject('Could not load blocks')
        }
      }catch(e){
        reject(e)
      }
      
      
    })
  }

  /**
    First, looks for genesisBlock in chain to see if blockchain has been created
      - If so, will load last block and will go about downloading the entire chain
      - If not, will load genesisBlock config from file (or create it) then will push it to 
        database and will initiate balance state table
    @return {Promise} Success or failure
  */
  loadBlocks(){
    return new Promise(async (resolve, reject)=>{
      const cliProgress = require('cli-progress');
      
      // create a new progress bar instance and use shades_classic theme
      console.log()
      const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
      //See if genesis block has been added to database
      try{
        let genesisBlock = await this.getGenesisBlockFromDB()
        if(genesisBlock){
          if(genesisBlock.error) reject(genesisBlock.error)
          let lastBlock = await this.getLastKnownBlockFromDB()
          if(lastBlock && lastBlock.blockNumber){
            let iterator = Array(lastBlock.blockNumber + 1)
            this.chain[0] = genesisBlock
            bar1.start(lastBlock.blockNumber, 0);
            for await(let blockNumber of [...iterator.keys()]){
              let block = await this.getBlockFromDB(blockNumber)
                if(block){
                  if(block.error) {
                    reject(block.error)
                  }
                  
                  let txHashes = Object.keys(block.transactions)
                  let actionHashes = Object.keys(block.actions)
                  for await(let hash of txHashes){
                    let transaction = block.transactions[hash]
                    if(transaction.type === 'payable' && transaction.reference){
                      this.spentTransactionHashes[hash] = block.blockNumber
                      this.spentTransactionHashes[transaction.reference.hash] = { referenceTo:hash }
                    }else{
                      this.spentTransactionHashes[hash] = block.blockNumber
                    }
                    //{ spent:block.blockNumber }
                  }
                  for await(let hash of actionHashes){
                    this.spentActionHashes[hash] = block.blockNumber//{ spent:block.blockNumber }
                  }
                  await this.manageChainSnapshotQueue(block)
                  this.chain.push(this.extractHeader(block))
                  bar1.update(block.blockNumber);
                  if(blockNumber == lastBlock.blockNumber){
                    bar1.stop();
                    console.log()
                    logger(`Finished loading ${parseInt(blockNumber) + 1} blocks`)
                    resolve(true)
                  }
                }
              
            }
          }else{
            this.chain.push(genesisBlock)
            logger(`Finished loading genesis block`) 
            resolve(true)
          }


        }else{
          logger('Genesis Block has not been created yet')
          let genesisBlock = await this.loadGenesisFile()
          logger('Loaded genesis block from config file')
          if(genesisBlock.error) reject(genesisBlock.error)

          balance.states = genesisBlock.states;
          let saved = await balance.saveBalances(genesisBlock)
          
          let added = await this.genesisBlockToDB(genesisBlock)
          if(added){
            if(added.error) reject(added.error)
            logger('Added genesis block to blockchain')
            this.chain.push(genesisBlock)
            
            resolve(true);

          }else{
            reject('Error adding genesis block to db')
          }
          
        }
        
      }catch(e){
        reject(e)
      }

    })
    
  }

  /**
   * Saves only the last block to JSON file
   */
  save(){
    return new Promise(async (resolve)=>{
      let lastBlock = await this.saveLastKnownBlockToDB()
      if(lastBlock){
        if(lastBlock.error) resolve({error:lastBlock.error})
        resolve(true);
       
      }else{
        logger('ERROR: Could not save blockchain state')
        resolve(false)
      }
      
    })
  }

}

module.exports = Blockchain;
