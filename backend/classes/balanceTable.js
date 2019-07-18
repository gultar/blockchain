const sha256 = require('../tools/sha256');
const { isValidTransactionJSON, isValidActionJSON } = require('../tools/jsonvalidator');
const { readFile, writeToFile, logger } = require('../tools/utils');
const fs = require('fs')

class BalanceTable{
    constructor(state, history){
        this.states = (state?state:{})
        this.history = (history?history:{})
    }

    saveHistory(blockNumber){
        return new Promise((resolve)=>{
            if(blockNumber !== undefined){
                let publicKeys = Object.keys(this.states)
                if(!this.history[blockNumber]) this.history[blockNumber] = {}
                publicKeys.forEach((key)=>{
                    if(this.states[key]){
                        this.history[blockNumber][key] = JSON.parse(JSON.stringify(this.states[key]))
                        // if(blockNumber > 0){
                        //     if(this.history[blockNumber - 1][key]){
                        //         if(this.states[key].balance !== this.history[blockNumber - 1][key].balance){
                                    
                        //         }
                        //     }
                            
                        // }
                    }
                })
                resolve(true)
            }else{
                resolve({error:'ERROR: Need to specify block number'})
            }
        })
        
    }

    executeTransactionBlock(transactions){
        return new Promise((resolve)=>{
            let hashes = Object.keys(transactions);
            let errors = {}
            hashes.forEach( hash=>{
                let tx = transactions[hash];
                let executed = this.executeTransaction(tx)
                if(executed.error) errors[hash] = executed.error;
            })
            let numOfErrors = Object.keys(errors).length;

            if(numOfErrors > 0) resolve({errors:errors})
            else resolve(true)
        })
        
    }

    executeTransaction(transaction){
        if(isValidTransactionJSON(transaction)){
            
            let fromAddress = transaction.fromAddress;
            let toAddress = transaction.toAddress;
            let amount = transaction.amount;
            let hash = transaction.hash;
            let miningFee = transaction.miningFee;

            if(fromAddress !== 'coinbase'){
                let coinsSpent = this.spend(fromAddress, amount+miningFee, hash);
                if(!coinsSpent.error){
                    let coinsGained = this.gain(toAddress, amount, hash);
                    if(coinsGained.error){
                        return { error:coinsGained.error }
                    }else{
                        return true;
                    }
                    
                }else{
                    return { error:coinsSpent.error };
                }
            }else{
                let coinsGained = this.gain(toAddress, amount, hash);
                if(coinsGained.error){
                    return { error:coinsGained.error }
                }else{
                    return true;
                }
            }
            
            
        }
    }

    executeActionBlock(actions){
        return new Promise((resolve)=>{
            
            if(actions){
                let hashes = Object.keys(actions);
                if(hashes > 0){
                    let errors = {}
                    hashes.forEach( hash=>{
                        let action = actions[hash];
                        let executed = this.executeAction(action)
                        if(executed.error) errors[hash] = executed.error;
                    })
                    let numOfErrors = Object.keys(errors).length;
        
                    if(numOfErrors > 0) resolve({errors:errors})
                    else resolve(true)
                }else{
                    resolve(false)
                }
                
            }else{
                resolve(false)
            }

        })
        
    }

    executeAction(action){
        if(isValidActionJSON(action)){
            
            let fromAddress = action.fromAddress;
            let hash = action.hash;
            let fee = action.fee;

            let coinsSpent = this.spend(fromAddress, fee, hash);
            if(!coinsSpent.error){
                return true;
            }else{
                return coinsSpent.error;
            }
            
        }
    }

    rollback(blockNumber){
        return new Promise((resolve)=>{
            if(blockNumber !== undefined){
                if(this.history[blockNumber]){
                    let publicKeys = Object.keys(this.history[blockNumber])
                
                    publicKeys.forEach((key)=>{
                        if(this.history[blockNumber] && this.history[blockNumber][key]){
                            this.states[key] = this.history[blockNumber][key]
                        }
                    })
                    resolve(true)
                }else{
                    resolve({error:`ERROR: Balance history at block ${blockNumber} does not exists`})
                }
               
            }else{
                resolve({error:'ERROR: Need to specify block number'})
            }
        })
    }

    getBalance(publicKey){
        return this.states[publicKey]
    }

    addNewWalletKey(publicKey){
        if(publicKey){
            this.states[publicKey] = {
                balance:0,
            }
        }else{
            return false
        }
        
    }

    spend(publicKey, value, txHash){
        if(publicKey && value && txHash){
            if(!this.states[publicKey]) return {error:'Wallet does not exist'};
            let state = this.states[publicKey];
            if(state.balance > value){
                state.balance -= value;
            }else{
                return { error:'ERROR: sending wallet does not have sufficient funds' }
            }
            return true;
        }else{
            return { error:'ERROR: missing required parameters (publicKey, value, txHash)' };
        }
        
    }

    gain(publicKey, value, txHash){
        if(publicKey && value && txHash){

              if(!this.states[publicKey]){
                let newWallet = this.addNewWalletKey(publicKey);
                if(!newWallet) return {error:'ERROR: Public key of wallet is undefined'}
              }
              
              let state = this.states[publicKey];
              state.balance += value;
            //   state.lastTransaction = txHash
              return true;
        }else{
            return { error:'ERROR: missing required parameters (publicKey, value, txHash)' };
        }
        
    }

    loadAllStates(){
        return new Promise(async (resolve, reject)=>{
            
         try{
             fs.exists('./data/balances.json', async (exists)=>{
                 if(exists){
                    let balancesFile = await readFile('./data/balances.json');
                    if(balancesFile){
                        let balances = JSON.parse(balancesFile);
                        if(balances){
                            
                            resolve(balances)
                        }else{
                            resolve(false)
                        }
                    }else{
                        resolve(false)
                    }
                 }else{
                    let savedBalances = await this.saveStates();
                    if(savedBalances){
                        resolve(savedBalances)
                    }else{
                        resolve(false)
                    }
                 }
                
             })

             
         }catch(e){
             console.log(e)
             resolve(false)
         }
        })
       }

      saveStates(){
          return new Promise((resolve, reject)=>{
            try{
                let saved = writeToFile({states:this.states, history:this.history}, './data/balances.json');
                if(saved){
                    logger('Saved balance states table');
                    resolve(saved)
                }
            }catch(e){
                reject(e)
            }
          })
        
      }

}

module.exports = BalanceTable;

