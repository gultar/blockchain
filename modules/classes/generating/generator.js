const { RecalculateHash, } = require('../../tools/utils');
const { isValidHeaderJSON } = require('../../tools/jsonvalidator');
  
const Miner = require('../mining/miner/miner')
const {Difficulty} = require('../mining/challenge')
const Block = require('../blockchain/block')
const ECDSA = require('ecdsa-secp256r1')
const genesis = require('../../tools/getGenesis')
const ioClient = require('socket.io-client')
const generatorLog = require('debug')('generator')


class BlockGenerator extends Miner{
    constructor({ keychain, numberOfCores, miningReward, verbose, broadcast }){
        super({ keychain, numberOfCores, miningReward, verbose })
        this.generationSpeed = genesis.blockTime || 2000//generationSpeed 
        this.generator = {}
        this.validators = {}
        this.validatorKeys = [this.wallet.publicKey]
        this.validatorOrder = Object.keys(genesis.validators)
        this.connectedValidators = []
        this.turn = this.validatorOrder[0]
        this.turnCounter = 0
        // this.nextTurn = this.validatorKeys[0]
        this.maxWaitingTime = 30 * 1000
        this.nodeIsBusy = false
        this.blocksToBeSigned = {}
        this.broadcast = broadcast
        this.numberOfTurnsPassed = 0
        this.cycle = 30 //turns
        this.timers = {}
        this.receptionTimers = {}
    }

    connect(url){
        if(!url) throw new Error('Valid URL is Required')
        
        let config = {
          query:
              {
                token: 'InitMiner',
                mode: 'generator'
              }
        }
        this.socket = ioClient(url, config)
        this.socket.on('connect', async ()=>{
            this.log('Miner connected to ', url)
            await this.initWallet()
            this.validators[this.wallet.publicKey] = { connected:true }
            this.socket.emit('isAvailable')
            // this.socket.emit('generate')
            this.orderValidatorKeys()
            this.firstTurn()
            this.sendPeerMessage('networkEvent', { type:'validatorConnected', publicKey:this.wallet.publicKey })
        })
        this.socket.on('disconnect', async ()=>{
            this.sendPeerMessage('networkEvent', { type:'validatorDisconnected', publicKey:this.wallet.publicKey })
            this.socket.close()
            process.exit()
        })
        this.socket.on('nodeIsBusy', (isBusy)=>{
            this.nodeIsBusy = isBusy
        })
        
        this.socket.on('pushedBlock', ()=>{
            generatorLog('Received pushed block event')
            this.nextTurn()
        })
        this.socket.on('networkEvent', async (peerMessage)=>{
            let event = JSON.parse(peerMessage.data)
            switch(event.type){
                case 'discoverValidator':
                    clearInterval(this.generator)
                    this.validators[event.publicKey] = { connected:true }
                    this.validatorKeys = Object.keys(this.validators)
                    await this.reset()
                    break;
                case 'validatorConnected':
                    clearInterval(this.generator)
                    this.validators[event.publicKey] = { connected:true }
                    this.validatorKeys = Object.keys(this.validators)
                    this
                    this.sendPeerMessage('networkEvent', { type:'discoverValidator', publicKey:this.wallet.publicKey })
                    await this.reset()
                    break;
                case 'validatorDisconnected':
                    clearInterval(this.generator)
                    delete this.validators[event.publicKey]
                    this.validatorKeys = Object.keys(this.validators)
                    await this.reset()
                    break;
                case 'generatingBlock':
                    if(this.turn == event.publicKey){
                        generatorLog('Received generating block event')
                        this.cancelConfirmationTimer(event.publicKey)
                        this.awaitBlockHeader(event.publicKey)
                    }else{
                        generatorLog('ERROR: Received confirmation from wrong validator', event.publicKey)
                    }
                    break;
                case 'requestSignature':
                    let header = event.header;
                    let publicKey = event.publicKey
                    if(this.turn == publicKey){
                        generatorLog('Received block header. About to validate and sign')
                        this.cancelReceptionTimer(publicKey)
                        let isValidHeader = this.validateBlockHeader(header)
                        if(isValidHeader){
                            this.stop()
                            let signature = await this.createSignature(header.hash)
                            this.sendPeerMessage('networkEvent', { type:'signature', signature:signature, hash:header.hash, publicKey:this.wallet.publicKey })
                            this.wait = false
                        }
                    }else{
                        generatorLog('ERROR: Received block header from wrong validator', event.publicKey)
                    }
                    break;
                case 'signature':
                    //expect block from validator whose turn it is only
                    let hash = event.hash
                    let block = this.blocksToBeSigned[hash]
                    if(block){
                        block.signatures[event.publicKey] = event.signature
                        if(Object.keys(block.signatures).length >= genesis.minimumSignatures){
                            this.wait = false
                            this.socket.emit('success', block)
                            delete this.blocksToBeSigned[block.hash]
                        }
                    }
                    
                    break;
            }
        })
        this.socket.on('previousBlock', (block)=> this.previousBlock = block)
        this.socket.on('rawBlock', async (rawBlock)=> await this.start(rawBlock))
        // this.socket.on('stopMining', async ()=> await this.stop())
    }

    async start(rawBlock){
        this.socket.emit('isPreparing')
        let block = await this.prepareBlockForMining(rawBlock);
        if(block){
            this.socket.emit('isMining')

            this.log('Starting to mint block '+block.blockNumber)
            this.log('Number of transactions being minted: ', Object.keys(block.transactions).length)
            this.log('Number of actions being minted: ', Object.keys(block.actions).length)
            this.log('Current difficulty:', BigInt(parseInt(block.difficulty, 16)))

            let success = false
            
            success = await block.produce(block.difficulty, this.numberOfCores)
            if(success){
                this.successMessage(success)
                this.stop()
                block = success;
                block.endMineTime = Date.now()
                this.previousBlock = block;
                block.signatures[this.wallet.publicKey] = await this.createSignature(block.hash)
                this.sendPeerMessage('networkEvent', { type:'requestSignature', publicKey:this.wallet.publicKey, header:this.extractHeader(block) })
                if(Object.keys(this.validators).length > 1){
                    this.blocksToBeSigned[block.hash] = block
                }else{
                    this.socket.emit('success', block)
                    
                }
                this.wait = true
            }else{
                this.log('Mining failed')
                this.socket.emit('failed')
            }
        }
    }

    async orderValidatorKeys(){
        let order = []

        for await(let key of Object.keys(genesis.validators)){
            if(this.validators[key]){
                order.push(key)
            }
        }
        this.validatorOrder = order
    }

    async prepareBlockForMining(rawBlock){
        
        let coinbase = await this.createCoinbase(rawBlock)
        coinbase.blockNumber = rawBlock.blockNumber
        rawBlock.transactions[coinbase.hash] = coinbase

        let block = new Block({
          blockNumber:rawBlock.blockNumber,
          timestamp:Date.now(),
          transactions:rawBlock.transactions,
          actions:rawBlock.actions,
          previousHash:rawBlock.previousHash
        })

        block.startMineTime = Date.now()
        block.coinbaseTransactionHash = coinbase.hash
        //Set difficulty level
        let difficulty = new Difficulty(this.genesis)
        block.difficulty = difficulty.setNewDifficulty(this.genesis, this.genesis);
        block.challenge = difficulty.setNewChallenge(this.genesis)
        block.totalDifficulty = this.calculateTotalDifficulty(block)
        block.minedBy = this.wallet.publicKey;
        return block
    }

    calculateTotalDifficulty(block){
      return (BigInt(parseInt(this.previousBlock.totalDifficulty, 16)) + BigInt(parseInt(block.difficulty, 16))).toString(16)
    }

    
    async createSignature(hash){
        let unlocked = await this.wallet.unlock(this.keychain.password)
        let signature = await this.wallet.sign(hash)

        let pubKey = ECDSA.fromCompressedPublicKey(this.wallet.publicKey)
        let isValid = pubKey.verify(hash, signature)
        if(!isValid){
            return await this.createSignature(hash)
        }
        else return signature
    }

    sendPeerMessage(type, data){
        this.socket.emit('sendPeerMessage', type, data)
    }

    awaitConfirmation(fromValidator){
        if(fromValidator !== this.wallet.publicKey){
            
            this.timers[fromValidator] = setTimeout(()=>{
                generatorLog('Did not receive confirmation in time, skipping turn of', fromValidator)
                this.nextTurn()
            }, genesis.blockTime)
        }
    }

    cancelConfirmationTimer(fromValidator){
        generatorLog('Received confirmation from ', fromValidator)
        clearTimeout(this.timers[fromValidator])
    }

    awaitBlockHeader(fromValidator){
        
        this.receptionTimers[fromValidator] = setTimeout(()=>{
            generatorLog('Did not receive block header in time, skipping turn of', fromValidator)
            this.nextTurn()
        }, this.maxWaitingTime)
    }

    cancelReceptionTimer(fromValidator){
        generatorLog('Received block header to sign from', fromValidator)
        clearTimeout(this.receptionTimers[fromValidator])
    }

    nextTurn(){
        (this.turnCounter < this.validatorOrder.length -1 ? this.turnCounter++ : this.turnCounter = 0)
        
        this.turn = this.validatorOrder[this.turnCounter]
        generatorLog('Okay, next turn', this.turn)
        generatorLog('My public key is', this.wallet.publicKey)
        generatorLog('Node is busy?', this.nodeIsBusy)
        if(this.turn == this.wallet.publicKey && !this.nodeIsBusy){
            generatorLog('Is my turn now', this.turn)
            this.sendPeerMessage('networkEvent', { type:'generatingBlock', publicKey:this.wallet.publicKey })
            this.socket.emit('sendRawBlock')
        }else{
            this.awaitConfirmation(this.turn)
        }
    }

    firstTurn(){
        this.turn = this.validatorOrder[this.turnCounter]
        generatorLog('Turn is', this.turn)
        if(this.turn == this.wallet.publicKey && !this.nodeIsBusy){
            generatorLog('Will now request raw block and send confirmation')
            this.sendPeerMessage('networkEvent', { type:'generatingBlock', publicKey:this.wallet.publicKey })
            this.socket.emit('sendRawBlock')
        }
        generatorLog('Will now await confirmation from peer validator', this.turn)
        this.awaitConfirmation(this.turn)
    }

    async reset(){
        this.turnCounter = 0
        generatorLog('Reseting turns')
        for await(let publicKey of Object.keys(this.timers)){
            if(this.timers[publicKey]) this.cancelConfirmationTimer(publicKey)
            if(this.receptionTimers[publicKey]) this.cancelReceptionTimer(publicKey)
        }
        await this.orderValidatorKeys()
        this.firstTurn()
    }

    validateBlockHeader(header){
        if(isValidHeaderJSON(header)){
          if(header.hash == RecalculateHash(header)) return true;
          else return false;
        }else return false;
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

    disconnect(){
        this.sendPeerMessage('networkEvent', { type:'validatorDisconnected', publicKey:this.wallet.publicKey })
    }

    
}

module.exports = BlockGenerator