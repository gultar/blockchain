const Miner = require('../mining/miner/miner')
const {Difficulty} = require('../mining/challenge')
const Block = require('../blockchain/block')
const ECDSA = require('ecdsa-secp256r1')
const Mempool = require('../mempool/pool')
const genesis = require('../../tools/getGenesis')
const ioClient = require('socket.io-client')

class Validator extends Miner{
    constructor({ keychain, numberOfCores, miningReward, verbose }){
        super({ keychain, numberOfCores, miningReward, verbose })
        this.mempool = new Mempool()
        this.generationSpeed = genesis.blockTime * 1000 || 2000//generationSpeed 
        this.generator = {}
        this.validators = {}
        this.validatorKeys = [this.wallet.publicKey]
        this.turnCounter = 0
        this.nextTurn = this.validatorKeys[0]
        this.nextTurnSkipped = setTimeout(()=>{})
    }

    connect(url){
        if(!url) throw new Error('Valid URL is Required')
        
        let config = {
          query:
              {
                token: 'InitMiner',
              }
        }
        this.socket = ioClient(url, config)
        this.socket.on('connect', async ()=>{
            this.log('Miner connected to ', url)
            await this.initWallet()
            this.validators[this.wallet.publicKey] = 'online'
            this.socket.emit('isAvailable')
            this.socket.emit('generate')
            this.generateBlocks()
            this.sendPeerMessage('networkEvent', { type:'validatorConnected', publicKey:this.wallet.publicKey })
        })
        this.socket.on('disconnect', async ()=>{
          this.sendPeerMessage('networkEvent', { type:'validatorDisconnected', publicKey:this.wallet.publicKey })
          this.socket.close()
          process.exit()
        })
        this.socket.on('networkEvent', (peerMessage)=>{
            let event = JSON.parse(peerMessage.data)
            switch(event.type){
                case 'discoverValidator':
                    clearInterval(this.generator)
                    // this.pickTurns()
                    this.validators[event.publicKey] = 'online'
                    this.validatorKeys = Object.keys(this.validators)
                    this.sendPeerMessage('networkEvent', { type:'nextTurn', publicKey:event.publicKey })
                    break;
                case 'validatorConnected':
                    clearInterval(this.generator)
                    // this.pickTurns()
                    this.validators[event.publicKey] = 'online'
                    this.validatorKeys = Object.keys(this.validators)
                    this.sendPeerMessage('networkEvent', { type:'discoverValidator', publicKey:this.wallet.publicKey })
                    break;
                case 'validatorDisconnected':
                    delete this.validators[event.publicKey]
                    this.validatorKeys = Object.keys(this.validators)
                    if(this.validatorKeys.length == 1) this.generateBlocks()
                    break;
                case 'nextTurn':
                    if(event.publicKey == this.wallet.publicKey){
                        clearTimeout(this.nextTurnSkipped)
                        setTimeout(()=>{
                            this.socket.emit('sendRawBlock')
                            let nextPublicKey = this.validatorKeys.pop()
                            this.sendPeerMessage('networkEvent', { type:'nextTurn', publicKey:nextPublicKey })
                            this.validatorKeys.push(nextPublicKey)
                            this.nextTurnSkipped = setTimeout(()=>{
                                nextPublicKey = this.validatorKeys.pop()
                                if(nextPublicKey == this.wallet.publicKey)  this.socket.emit('sendRawBlock')
                                this.sendPeerMessage('networkEvent', { type:'nextTurn', publicKey:nextPublicKey })
                                this.validatorKeys.push(nextPublicKey)
                            }, 2100)
                        }, 2000)
                    }
                    break;
            }
        })
        this.socket.on('previousBlock', (block)=> this.previousBlock = block)
        this.socket.on('rawBlock', async (rawBlock)=> await this.start(rawBlock))
        this.socket.on('stopMining', async ()=> await this.stop())
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
            
            success = await block.validate(block.difficulty, this.numberOfCores)
            if(success){
                this.successMessage(success)
                this.stop()
                block = success;
                block.endMineTime = Date.now()
                this.previousBlock = block;
                block.signatures[this.wallet.publicKey] = await this.createSignature(block.hash)
                this.socket.emit('success', block)

            }else{
                this.log('Mining failed')
                this.socket.emit('failed')
            }
        }
    }

    async prepareBlockForMining(rawBlock){
        
        let coinbase = await this.createCoinbase()
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
        block.totalDifficulty = this.calculateTotalDifficulty(this.genesis)
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
        if(!isValid) this.createSignature(hash)
        else return signature
    }

    sendPeerMessage(type, data){
        this.socket.emit('sendPeerMessage', type, data)
    }

    generateBlocks(){
        this.generator = setInterval(async ()=>{
            this.sendPeerMessage('networkEvent', { type:'nextTurn', publicKey:this.wallet.publicKey })
            if(this.validatorKeys.length == 1 || this.nextTurn == this.wallet.publicKey){
                // this.socket.emit('sendRawBlock')
                console.log('My turn:', this.wallet.publicKey)
                // this.nextTurnSkipped = setTimeout(()=>{ console.log('Would normally skip turn') }, 2100)
            }
        }, this.generationSpeed)
    }

    pickTurns(){
        setInterval(()=>{
            
        }, 100)
    }

    
}

module.exports = Validator