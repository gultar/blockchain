
const { logger } = require('../tools/utils')
const chalk = require('chalk')

/**
 * An api that links the miner process and the node and gathers transactions for it
 * @class
 * @param {Object} params - Api param object
 * @param {Blockchain} params.chain - A copy of the active blockchain
 * @param {Mempool} params.mempool - A copy of the active mempool
 * @param {EventEmitter} params.channel - Event emitter instance supplied by the node
 * @param {Function} params.sendPeerMessage - Function that will serve to broadcast new blocks
 * @param {Socket} params.socket - Server socket on which the miner will connect
 */
class MinerAPI{
    constructor({ chain, mempool, channel, sendPeerMessage, socket }){
        this.chain = chain
        this.mempool = mempool
        this.channel = channel
        this.sendPeerMessage = sendPeerMessage
        this.isMinerBusy = false;
        this.isAPIBusy = false;
        this.socket = socket
        this.generate = false
        this.verbose = false
    }

    init(){
        this.socket.on('success', async(block) => {
            this.isAPIBusy = true
            let result = await this.addMinedBlock(block)
            if(result.error && result.isRoutingBlock) logger(chalk.yellow('MINER WARNING'), result.error)
            else if(result.error) logger(chalk.red('MINER ERROR'),result.error)
            this.isAPIBusy = false
        })
        this.socket.on('generate', ()=>{
            this.generate = true
        })
        this.socket.on('isApiReady', async ()=>{
            if(!this.generate &&
               !this.isAPIBusy && 
               !this.isMinerBusy && 
               !this.isNodeWorking && 
               !this.nodeOutOfSync && 
               !this.nodeIsDownloading &&
               !this.isNodeRoutingBlock){
                
                await this.sendNewBlock()
            }
        })
        this.socket.on('isStopped', ()=>{ this.isMinerBusy = false })
        this.socket.on('isMining', ()=>{ this.isMinerBusy = true })
        this.socket.on('isPreparing', ()=>{ this.isMinerBusy = true })
        this.socket.on('disconnect', ()=>{
            this.channel.removeAllListeners('nodeEvent')
            this.mempool.events.removeAllListeners('newAction')
            this.mempool.events.removeAllListeners('newTransaction')
        })
        //This is for when node is syncing a block or busy doing something else
        this.channel.on('nodeEvent', async(event)=>{
            switch(event){
                case 'isBusy':
                    this.socket.emit('stopMining')
                    this.isAPIBusy = true
                    break;
                case 'isAvailable':
                    this.isAPIBusy = false
                    break;
                case 'isSwitchingBranch':
                case 'isRollingBack':
                    this.socket.emit('stopMining')
                    this.isNodeWorking = true
                    break;
                case 'finishedSwitchingBranch':
                case 'finishedRollingBack':
                    this.isNodeWorking = false
                    break;
                    
                case 'isDownloading':
                    this.socket.emit('stopMining')
                    this.nodeIsDownloading = true
                    break;
                case 'isRoutingBlock':
                    this.socket.emit('stopMining')
                    this.isNodeRoutingBlock = true
                    break;
                case 'finishedRoutingBlock':
                    this.isNodeRoutingBlock = false
                    break;
                case 'finishedDownloading':
                    this.nodeIsDownloading = false
                    break;
                case 'outOfSync':
                    logger('Node is out of sync. Stopped mining')
                    this.socket.emit('stopMining')
                    this.nodeOutOfSync = true
                    break;
                case 'inSync':
                    this.nodeOutOfSync = false
                    break;
                case 'stopMining':
                    //Stop miner
                    this.socket.emit('stopMining')
                    break;
                case 'startMining':
                    if(!this.generate &&
                       !this.isAPIBusy &&
                       !this.isMinerBusy &&
                       !this.isNodeWorking &&
                       !this.nodeOutOfSync &&
                       !this.nodeIsDownloading &&
                       !this.isNodeRoutingBlock){
                        await this.sendNewBlock()
                    }
                    break;
                case 'verbose':
                    //Stop miner
                    console.log('Received verbose message', this.verbose)
                    if(!this.verbose) this.verbose = true
                    else if(this.verbose) this.verbose = false
                    break;
            }
        })

        this.socket.on('sendRawBlock', async ()=>{
            await this.sendNewBlock({ generate:true })
            this.sendPeerMessage('networkEvent', { test:true })
        })

        this.socket.on('sendPeerMessage', async (type, data)=>{
            this.sendPeerMessage(type, data)
        })
    }

    async addMinedBlock(block){
        let isValidHeader = await this.chain.validateHeader(block)
        let isValidBody = await this.chain.validateBlockBody(block)
        if(isValidHeader.error) return { error:isValidHeader.error }
        else if(isValidBody.error) return { error:isValidBody.error }
        else{
            
            if(this.isNodeRoutingBlock) return { error:`ERROR: Couldn't add block ${block.blockNumber}, node is routing block` }
            //To guard against accidentally creating doubles
            let isNextBlock = block.blockNumber == this.chain.getLatestBlock().blockNumber + 1
            let headerExists = this.chain[block.blockNumber]
            if(!headerExists) headerExists = await this.chain.getBlockbyHash(block.hash)
            let exists = await this.chain.getBlockFromDB(block.blockNumber)
            
            if(!exists && !headerExists && isNextBlock){
                
                //Broadcast new block found
                this.sendPeerMessage('newBlockFound', block);
                //Sync it with current blockchain, skipping the extended validation part
                let added = await this.chain.receiveBlock(block)
                if(added.error) return added
                else{
                    
                    return block
                }
            }else if(exists){
                return { error:`ERROR: Block ${block.blockNumber} exists in DB` }
            }else if(headerExists){
                return { error:`ERROR: Block ${block.blockNumber}'s header is already in the chain` }
            }else if(!isNextBlock){
                return { error:`ERROR: Mined Block ${block.blockNumber} is not next block` }
            }
        }
    }

    async sendNewBlock(forceSend=false){
        //Render busy to avoid send a hundred raw blocks to the miner
        this.isAPIBusy = true
        let latestBlock = await this.getLatestFullBlock()
        let newRawBlock = await this.createRawBlock(latestBlock, forceSend)
        if(!newRawBlock.error && !newRawBlock.empty) {
            this.socket.emit('previousBlock', latestBlock)
            this.socket.emit('rawBlock', newRawBlock)
        }else if(newRawBlock.empty){
            if(this.verbose) logger('WARNING:', newRawBlock.empty)
        }else{
            logger('RAW BLOCK ERROR:', newRawBlock)
        }
        this.isAPIBusy = false
    }

    async createRawBlock(nextBlock, forceSend){
        
        let latest = await this.getLatestFullBlock()
        //Checks for tx deferred to next block
        let deferredTxManaged = await this.mempool.manageDeferredTransactions(latest)
        if(deferredTxManaged.error) console.log({ error:deferredTxManaged.error })

        let transactions = await this.mempool.gatherTransactionsForBlock()
        if(transactions.error) return { error:transactions.error }
        //Validate all transactions to be mined, delete those that are invalid
        transactions = await this.chain.validateTransactionsBeforeMining(transactions)
        
        //Checks for actions deferred to next block
        let deferredActionsManaged = await this.mempool.manageDeferredActions(latest)
        if(deferredActionsManaged.error) console.log({ error:deferredActionsManaged.error })

        let actions = await this.mempool.gatherActionsForBlock()
        if(actions.error) return { error:actions.error }

        //Validate all actions to be mined, delete those that are invalid
        actions = await this.chain.validateActionsBeforeMining(actions)

        if(!forceSend && Object.keys(transactions).length == 0 && Object.keys(actions).length == 0){
            return { empty:'Could not create block without transactions or actions' }
        } 
        
        let rawBlock = {
            timestamp:Date.now(),
            transactions:transactions,
            actions:actions,
            previousHash:nextBlock.hash,
            blockNumber:nextBlock.blockNumber + 1
        }
        
        return rawBlock
    }

    async getLatestFullBlock(){
        //Get the current header
        //Since the header is always added before running the entire block
        //We check to see if a block is currently being runned
        //If so, get the previous block
        let latestHeader = this.chain.getLatestBlock()
        let block = latestHeader
        if(latestHeader.blockNumber >= 1){
            let block = await this.chain.getBlockFromDB(latestHeader.blockNumber)
            if(!block || block.error){
                block = await this.chain.getBlockFromDB(latestHeader.blockNumber - 1)
            }
        }else{
            block = latestHeader
        }
        return block
    }

    //In case another peer finds a block, unwrap discarded block to add back transactions and actions
    async unwrapBlock(block){
        if(block){
          let putback = await this.mempool.putbackTransactions(block)
          if(putback.error) return {error:putback.error}
          if(block.actions){
            let actionsPutback = await this.mempool.putbackActions(block)
            if(actionsPutback.error) return {error:actionsPutback.error}
          }
          return { transactions:putback, actions:putback }
        }else{
          return false
        }
    }
}

module.exports = MinerAPI
