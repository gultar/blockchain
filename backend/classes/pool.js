const Database = require('./database')
const jsonSize = require('json-size');


class Mempool{
    constructor(){
        this.transactions = new Database('./data/transactionDB')
        this.actions = new Database('./data/actionDB')
        this.txReceipts = {}
        this.actionReceipts = {}
        this.usedTxReceipts = {}
        this.usedActionReceipts = {}
        this.maxBatchSize = 50000
        this.busyGathering = false
    }

    addTransaction(transaction){
        return new Promise( async (resolve)=>{
            let added = await this.transactions.add({
                _id:transaction.hash,
                [transaction.hash]:transaction
            })
            if(added.error) resolve({error:added.error})
            else if(added){
                let receipt = await this.createTransactionReceipt(transaction)
                if(receipt.error) resolve({error:receipt.error})
                this.txReceipts[transaction.hash] = receipt
                resolve({added:true, receipt:receipt})
            }

            
        })
    }
    addAction(action){
        return new Promise( async (resolve)=>{
            let added = await this.actions.add({
                _id:action.hash,
                [action.hash]:action
            })
            if(added.error) resolve({error:added.error})
            else if(added){
                let receipt = await this.createActionReceipt(action)
                if(receipt.error) resolve({error:receipt.error})

                this.actionReceipts[action.hash] = receipt
                resolve({added:true, receipt:receipt})
            }
        })
    }

    getTransaction(hash){
        return new Promise(async (resolve)=>{
            let entry = await this.transactions.get(hash)

            if(entry){
                if(entry.error) resolve({error:entry.error})

                resolve(entry[hash])
            }else{
                resolve(false)
            }
        })
    }

    getAction(hash){
        return new Promise(async (resolve)=>{
            let entry = await this.actions.get(hash)

            if(entry){
                if(entry.error) resolve({error:entry.error})

                resolve(entry[hash])
            }else{
                resolve(false)
            }
        })
    }

    createTransactionReceipt(transaction){
        return new Promise( async (resolve)=>{
            let receipt = {
                fromAddress:transaction.fromAddress,
                toAddress:transaction.toAddress,
                amount:transaction.amount,
                miningFee:transaction.miningFee,
                size:jsonSize(transaction)
            }

            resolve(receipt)
        })
    }

    createActionReceipt(action){
        return new Promise( async (resolve)=>{
            let receipt = {
                fromAccount:action.fromAccount,
                type:action.type,
                task:action.task,
                fee:action.fee,
                size:jsonSize(action)
            }

            resolve(receipt)
        })
    }

    useTransaction(hash){
        return new Promise((resolve)=>{
            let receipt = this.txReceipts[hash]
            if(receipt){
                this.usedTxReceipts[hash] = JSON.parse(JSON.stringify(receipt))
                delete this.txReceipts[hash]
                resolve(true)
            }else{
                resolve({error:`Could not use transaction of hash ${hash}`})
            }
        })
    }

    unuseTransaction(hash){
        return new Promise((resolve)=>{
            let receipt = this.usedTxReceipts[hash]
            if(receipt){
                this.txReceipts[hash] = JSON.parse(JSON.stringify(receipt))
                delete this.usedTxReceipts[hash]
                resolve(true)
            }else{
                resolve({error:`Could not unuse transaction of hash ${hash}`})
            }
        })
    }

    useAction(hash){
        return new Promise((resolve)=>{
            let receipt = this.actionReceipts[hash]
            if(receipt){
                this.usedActionReceipts[hash] = JSON.parse(JSON.stringify(receipt))
                delete this.actionReceipts[hash]
                resolve(true)
            }else{
                resolve({error:`Could not use action of hash ${hash}`})
            }
        })
    }

    unuseAction(hash){
        return new Promise((resolve)=>{
            let receipt = this.usedActionReceipts[hash]
            if(receipt){
                this.actionReceipts[hash] = JSON.parse(JSON.stringify(receipt))
                delete this.usedActionReceipts[hash]
                resolve(true)
            }else{
                resolve({error:`Could not unuse action of hash ${hash}`})
            }
        })
    }

    gatherTransactionsForBlock(){
        return new Promise( async (resolve)=>{
            let transactions = {}
            let hashes = Object.keys(this.txReceipts)
            let errors = {}
            for await(var hash of hashes){
                let batchSize = await this.calculateSizeOfBatch(transactions);

                if(batchSize < this.maxBatchSize){
                    let transaction = await this.getTransaction(hash)
                    
                    if(transaction){
                        if(transaction.error) errors[hash] = transaction.error

                        let used = await this.useTransaction(hash)
                        if(used){
                            if(used.error) errors[hash] = used.error
                            transactions[transaction.hash] = transaction
                        }
                    }
                    
                }
                
            }

            if(Object.keys(errors).length > 0) resolve({error:errors})
            else resolve(transactions)
        })
    }

    putbackTransactions(block){
        return new Promise(async (resolve)=>{
            let txHashes = Object.keys(block.transactions);
            let errors = {}
            for await(let hash of txHashes){
                if(this.usedTxReceipts[hash]){
                    let unused = await this.unuseTransaction(hash);
                    if(unused.error) errors[hash] = unused.error
                }
            }

            if(Object.keys(errors).length > 0) resolve({error:errors})
            else resolve(true)
        })
    }
    gatherActionsForBlock(){
        return new Promise( async (resolve)=>{
            let actions = {}
            let hashes = Object.keys(this.actionReceipts)
            let errors = {}
            for await(var hash of hashes){
                let batchSize = await this.calculateSizeOfBatch(actions);

                if(batchSize < this.maxBatchSize){
                    let action = await this.getAction(hash)
                    
                    if(action){
                        if(action.error) errors[hash] = action.error
                        
                        let used = await this.useAction(hash)
                        if(used){
                            if(used.error) errors[hash] = used.error
                            actions[action.hash] = action
                        }
                        
                    }
                    
                }
                
            }

            if(Object.keys(errors).length > 0) resolve({error:errors})
            else resolve(actions)
        })
    }
    putbackActions(block){
        return new Promise(async (resolve)=>{
            let actionHashes = Object.keys(block.actions);
            let errors = {}
            for await(let hash of actionHashes){
                if(this.usedActionReceipts[hash]){
                    let unused = await this.unuseAction(hash);
                    if(unused.error) errors[hash] = unused.error
                }
            }

            if(Object.keys(errors).length > 0) resolve({error:errors})
            else resolve(true)
        })
    }
    deleteTransactionsFromMinedBlock(transactions){
        return new Promise(async (resolve)=>{
            let hashes = Object.keys(transactions)
            let errors = {}

            for(var hash of hashes){
                let entry = await this.transactions.get(hash)
                if(entry){
                    if(entry.error) errors[hash] = entry.error

                    delete this.usedTxReceipts[hash]
                    let deleted = await this.transactions.delete(entry)
                    if(deleted){
                        if(deleted.error) errors[hash] = deleted.error 
                    }
                    
                }
                
            }

            if(Object.keys(errors) > 0){
                resolve({error:errors})
            }else{
                resolve(true)
            }

        })
    }

    deleteActionsFromMinedBlock(actions){
        return new Promise(async (resolve)=>{
            let hashes = Object.keys(actions)
            let errors = {}


            for await(var hash of hashes){
                let entry = await this.actions.get(hash)
                if(entry){
                    if(entry.error) resolve({error:entry.error})

                    delete this.actionReceipts[hash]
                    let deleted = await this.actions.delete(entry)
                    if(deleted){
                        if(deleted.error) errors[hash] = deleted.error 
                    }
                    

                }
                
            }

            if(Object.keys(errors) > 0){
                resolve({error:errors})
            }else{
                resolve(true)
            }
        })
    }
    sizeOfPool(){
        if(Object.keys(this.txReceipts).length > 0){
            let size = Object.keys(this.txReceipts).length
            return size
        }else{
            return 0
        }
        
    }
    sizeOfActionPool(){
        if(Object.keys(this.actionReceipts).length > 0){
            let size = Object.keys(this.actionReceipts).length
            return size
        }else{
            return 0
        }
    }

    calculateSizeOfBatch(batch){
        return new Promise( async (resolve)=>{
            let totalSize = 0;
            let hashes = Object.keys(batch)
            for await(var hash of hashes){
                let size = 0
                if(this.txReceipts[hash]){
                    size = this.txReceipts[hash].size
                }else if(this.actionReceipts[hash]){
                    size = this.actionReceipts[hash].size
                }

                totalSize += size
            }

            resolve(totalSize)
        })
    }
    
    orderTransactionsByTimestamp(transactions){
        return new Promise( async (resolve)=>{
            if(typeof transactions == 'object'){
                let txHashes = Object.keys(transactions);
                let orderedTransaction = {};
                let txAndTimestamp = {};
        
                if(txHashes){
                  txHashes.forEach( hash =>{
                    let transaction = transactions[hash];
                    txAndTimestamp[transaction.timestamp] = hash;
                  })
        
                  let timestamps = Object.keys(txAndTimestamp);
                  timestamps.sort(function(a, b){return a-b});
                  timestamps.forEach( timestamp=>{
                    let hash = txAndTimestamp[timestamp];
                    let transaction = transactions[hash];
                    orderedTransaction[hash] = transaction;
                  })
        
                  return orderedTransaction;
        
                }
        
            }
        })
    }

    orderTransactionsByMiningFee(transactions){
        return new Promise( async (resolve)=>{
            if(typeof transactions == 'object'){
                let txHashes = Object.keys(transactions);
                let orderedTransaction = {};
                let txAndMiningFee = {};
        
                if(txHashes){
                  txHashes.forEach( hash =>{
                    let transaction = transactions[hash];
                    txAndMiningFee[transaction.miningFee] = hash;
                  })
        
                  let miningFees = Object.keys(txAndMiningFee);
                  miningFees.sort(function(a, b){return a-b});
                  miningFees.forEach( miningFee=>{
                    let hash = txAndMiningFee[miningFee];
                    let transaction = transactions[hash];
                    orderedTransaction[hash] = transaction;
                  })
        
                  return orderedTransaction;
        
                }
        
            }
        })
    }

    rejectTransaction(hash){
        return new Promise(async (resolve)=>{
            let entry = await this.transactions.get(hash)
            if(entry){
                if(entry.error) resolve({error:entry.error})

                let deleted = await this.transactions.delete(entry)

                if(deleted){
                    if(deleted.error) resolve({error:deleted.error})
                    else   resolve(deleted)
                    
                }
            }
        })
    }

    rejectAction(hash){
        return new Promise(async (resolve)=>{
            let entry = await this.actions.get(hash)
            if(entry){
                if(entry.error) resolve({error:entry.error})

                let deleted = await this.actions.delete(entry)

                if(deleted){
                    if(deleted.error) resolve({error:deleted.error})
                    else   resolve(deleted)
                    
                }
            }
        })
    }

    loadMempool(){
        return new Promise(async (resolve)=>{
            let txEntry = await this.transactions.get('receipts')
            let actionEntry = await this.actions.get('receipts')

            if(txEntry.error) resolve({error:this.txReceipts.error})
            if(actionEntry.error) resolve({error:this.actionReceipts.error})

            this.txReceipts = txEntry.receipts || {};
            this.actionReceipts = actionEntry.receipts || {};

            resolve(true)
        })
    }

    saveMempool(){
        return new Promise( async (resolve)=>{
            let savedTxReceipts = await this.transactions.add({
                _id:'receipts',
                'receipts':this.txReceipts
            })

            let savedActionReceipts = await this.actions.add({
                _id:'receipts',
                'receipts':this.actionsReceipts
            })

            if(savedTxReceipts.error) resolve({error:savedTxReceipts.error})
            if(savedActionReceipts.error) resolve({error:savedActionReceipts.error})

            resolve(true)
        })
    }
}

module.exports = Mempool