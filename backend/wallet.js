const ECDSA = require('ecdsa-secp256r1');
const { logger } = require('./utils');
const sha256 = require('./sha256');
const sha1 = require('sha1');
const { encrypt, decrypt } = require('./utils')
const fs = require('fs')
let _ = require('private-parts').createKey();

class Wallet{
    
    constructor(){
        this.id = '';
        _(this).privateKey = '';
        this.publicKey = '';
        this.transactions = {}
    }

    generateEntropy(){
        var randomGen = '';
        for(var i=0; i<100; i++){
            var nonce = Math.floor(Date.now()*Math.random()*100*Math.random());
            nonce = nonce.toString();
            randomGen = randomGen.concat(nonce);

        }
        return randomGen;
    }

    // async generatePrivateKey(){
    //     if(!_(this).privateKey){
            
    //     }
    // }
  
    // generateAddress(){
    //     if(!this.publicKey){
            
    //     }
    // }

    // generateID(){
    //     if(!this.id && this.publicKey){
    //         this.id = sha1(this.publicKey);
    //     }
    // }

    async createCompressedPublicKey(){
        return await _(this).privateKey.toCompressedPublicKey()
    }

    async getWallet(){
        let wallet = this;
        return wallet;
    }

    async init(seed){
        
        let secretSeed = (seed ? seed : this.generateEntropy())
        
        return new Promise(async (resolve, reject)=>{
            try{
                _(this).privateKey = await ECDSA.generateKey(secretSeed);
                this.publicKey = await this.createCompressedPublicKey();
                this.id = await sha1(this.publicKey);
                if(_(this).privateKey && this.publicKey && this.id){
                    resolve(this);
                }else{
                    resolve(false);
                }
            }catch(e){
                console.log(e);
                resolve(false);
            }
            
            
        })
        
    }

    async initFromJSON(json){
        return new Promise(async (resolve, reject)=>{
            if(json){
                try{
                    this.id = json.id;
                    this.publicKey = json.publicKey;
                    this.transactions = json.transactions;
                    _(this).privateKey = ECDSA.fromJWK(json.privateKey);

                    resolve(true)
                }catch(e){
                    console.log(e);
                    reject(e);
                }
                
            }
        })
        
    }

    getSignature(data){
        if(data){
            return _(this).privateKey.sign(data)
        }else{
            logger('ERROR: could not sign data')
        }
    }

    async sign(data){
        if(data && _(this).privateKey){
            let signature = ''
            try{
                if(typeof data == 'object'){
                    let message = JSON.stringify(data);
                    signature = this.getSignature(message)

                }else if(typeof data == 'string'){
                    signature = this.getSignature(data)
                }
                
                return signature;

            }catch(e){
                console.log(e)
            }
        }
    }

    

    saveWallet(filename){
        if(this.publicKey && _(this).privateKey && filename){
            
            const formatToJWK = () =>{
                 return _(this).privateKey.toJWK();
            }

            _(this).privateKey = formatToJWK()
            let walletToSave = {
                publicKey:this.publicKey,
                privateKey:_(this).privateKey,
                id:this.id,
                transaction:this.transactions
            }
            let walletString = JSON.stringify(walletToSave, null, 2);
            var wstream = fs.createWriteStream(filename);

            wstream.write(walletString);
            wstream.end();
        }else{
            logger('ERROR: cannot save empty wallet');
            
        }
    }

    async loadWalletFromFile(pathAndFilename){
        return new Promise((resolve, reject)=>{
            fs.exists(pathAndFilename, (exists)=>{
                if(exists){
                    try{
                        var data = '';
                        var rstream = fs.createReadStream(pathAndFilename);
              
                        rstream.on('error', (err) =>{
                          logger(err);
                          resolve(err)
                        })
              
                        rstream.on('data', (chunk) => {
                          data += chunk;
                        });
              
              
                        rstream.on('close', () =>{  // done
                          if(data != undefined){
                              let wallet = JSON.parse(data);
                              this.publicKey = wallet.publicKey;
                              _(this).privateKey = ECDSA.fromJWK(wallet.privateKey);
                              this.id = wallet.id;
                              resolve(wallet);
                          }else{
                            resolve(false);
                          }
                        });
                    }catch(e){
                        console.log(e);
                        resolve(false)
                    }
                }
            })
        })
        
    }
  
  }

  module.exports = Wallet