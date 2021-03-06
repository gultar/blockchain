#!/usr/bin/env node

const program = require('commander');
const axios = require('axios')
const Transaction = require('./modules/classes/transactions/transaction')
const WalletManager = require('./modules/classes/wallets/walletManager')
const ioClient = require('socket.io-client');
const manager = new WalletManager()
const activePort = require('dotenv').config({ path: './config/.env' })
if (activePort.error) throw activePort.error
const nodeAddress = 'http://localhost:'+activePort.parsed.API_PORT

const parseDataArgument = (dataString) =>{
    return new Promise((resolve)=>{
        if(typeof dataString == 'string'){
            try{
                let data = JSON.parse(dataString);
                resolve(data)
            }catch(e){
                resolve(false)
            }
        }
    })
}

const openSocket = async (address, runFunction) =>{
    let socket = ioClient(address, {'timeout':1000, 'connect_timeout': 1000});
    
    if(socket){
        runFunction(socket);
    }else{
        console.log('Could not connect to node')
    }
}

const txgen = (program) =>{
    return new Promise(async (resolve)=>{
        let amount = JSON.parse(program.amount);
        let data = ''
        if(program.data){
            data = await parseDataArgument(program.data)
        }
        let speed = (program.speed && !isNaN(parseInt(program.speed)) ? parseInt(program.speed) : 1000)
        openSocket(`${nodeAddress}`, (socket)=>{
            
            let generator = setInterval(async ()=>{
                    let transaction = new Transaction
                    ({
                        fromAddress:program.fromAddress,
                        toAddress:program.toAddress,
                        amount:amount,
                        data:data,
                        type:program.type
                    });
                let wallet = await manager.loadByWalletName(program.walletName)
                if(wallet){
                    let unlocked = await wallet.unlock(program.password)
                    if(unlocked){
                        let signature = await wallet.sign(transaction.hash);
                        if(signature){
                            transaction.signature = signature;
                            socket.emit('transaction', transaction)
                           
                        }else{
                            console.log('ERROR: Could not sign transaction')
                        }
                    }else{
                        console.log('ERROR: Could not unlock wallet')
                    }
                }else{
                    console.log('ERROR: Could not find wallet')
                }
                
            }, speed)
            socket.on('transactionEmitted', (result)=>{
                if(result.error) console.log(result)//clearInterval(generator)
                // else if(result.result) console.log(result.result)
                else console.log(result)
            })
            socket.on('disconnect', ()=>{
                console.log('Stopping txgen')
                process.exit(0)
            })
        })
        
        
    })
}

program
.option('-w, --walletName <walletName>', "Sender's wallet name")
.option('-p, --password <password>', "Sender's wallet password")
.option('-f, --fromAddress <fromAddress>', "Sender's public key")
.option('-t, --toAddress <toAddress>', "Receiver's public key")
.option('-a, --amount <amount>', "Amount of coins to be transfered")
.option('-k, --type <type>', "Type of transaction")
.option('-d, --data <data>', "Optional data to be added")
.option('-u, --url <nodeURL>', "URL of running node to send transaction to")
.option('-s, --speed <speed>', 'Speed of loop interval')
.description('Sends a transaction to another wallet')
.action(async ()=>{
    if(program.walletName && program.password && nodeAddress){
        if(program.fromAddress){
            if(program.toAddress){
                if(program.amount){

                   txgen(program)
                   
                }else{
                    console.log('ERROR: Need to provide amount to transfer')
                }
            }else{
                console.log('ERROR: Need to provide receiving address')
            }
        }else{
            console.log('ERROR: Need to provide sender address')
        }
    }else{
        console.log('ERROR: Need to provide wallet name & password and url of node')
    }
})

program.parse(process.argv)