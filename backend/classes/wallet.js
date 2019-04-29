const ECDSA = require('ecdsa-secp256r1');
const { logger } = require('../tools/utils');
const sha256 = require('../tools/sha256')
const sha1 = require('sha1');
const fs = require('fs')
let _ = require('private-parts').createKey();

class Wallet{
    
    constructor(){
        this.name = ''
        this.id = '';
        _(this).privateKey = '';
        this.publicKey = '';
        _(this).passwordHash = '';
        _(this).locked = true;
        
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

    async createCompressedPublicKey(){
        return await _(this).privateKey.toCompressedPublicKey()
    }

    async init(seed, password){
        
        let secretSeed = (seed ? seed : this.generateEntropy())
        
            return new Promise(async (resolve, reject)=>{

                if(typeof seed == 'string' && typeof password == 'string'){
                    try{
                    
                        _(this).privateKey = ECDSA.generateKey(secretSeed);
                        this.publicKey = await this.createCompressedPublicKey();
                        this.name = ( seed ? seed : sha1(secretSeed));
                        this.id = await sha1((seed? seed:this.publicKey));
                        _(this).locked = true;
                        this.setPassword(password);
                        if(_(this).privateKey && this.publicKey && this.id){
                            resolve(this);
                        }else{
                            resolve(false);
                        }
                    }catch(e){
                        console.log(e);
                        resolve(false);
                    }
                
                }else{
                    resolve(false)
                }
            })
        
        
        
    }

    unlock(password){
        return new Promise(async (resolve, reject)=>{
            
            let isPasswordValid = await this.isPasswordValid(password);
            if(isPasswordValid){
                _(this).locked = false;
                this.lock();
                resolve(true)
            }else{
                resolve(false)
            }

            
        })
        
    }

    lock(){
        setTimeout(()=>{
          _(this).locked = true;
        }, 5 * 60 * 1000)
       
    }

    setPassword(password){
        if(password && !_(this).passwordHash){
            _(this).passwordHash = sha256(password);
        }
    }

    isPasswordValid(password){
        return new Promise((resolve, reject)=>{
            if(password && typeof password == 'string'){
            
                let pwdHash = _(this).passwordHash
                resolve(pwdHash == sha256(password))

            }else{
                resolve(false)
            }
        })
        
    }

    async initFromJSON(json){
        return new Promise(async (resolve, reject)=>{
            if(json){
                try{
                    this.id = json.id;
                    this.publicKey = json.publicKey;
                    this.name = json.name;
                    _(this).privateKey = ECDSA.fromJWK(json.privateKey);
                    _(this).passwordHash = json.passwordHash
                    _(this).locked = true;
                    resolve(true)
                }catch(e){
                    console.log(e);
                    reject(e);
                }
                
            }
        })
        
    }


    async sign(data){
        if(data && _(this).privateKey){
            
            const getSignature = (data)=>{
                if(!_(this).locked){
                    if(_(this).privateKey && data){
                        return _(this).privateKey.sign(data)
                    }else{
                        logger('ERROR: could not sign data')
                        return false
                    }
                }else{
                    logger('ERROR: Wallet locked')
                    return false
                }
               
            }

            let signature = ''
            
            try{
                if(typeof data == 'object'){
                    let message = JSON.stringify(data);
                    signature = getSignature(message)

                }else if(typeof data == 'string'){
                    signature = getSignature(data)
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
                let key = _(this).privateKey
                 return key.toJWK();
            }

            let walletToSave = {
                publicKey:this.publicKey,
                privateKey:formatToJWK(),
                id:this.id,
                name:this.name,
                passwordHash:_(this).passwordHash,
            }
            let walletString = JSON.stringify(walletToSave, null, 2);
            var wstream = fs.createWriteStream(filename);

            wstream.write(walletString);
            wstream.end();
        }else{
            logger('ERROR: cannot save empty wallet');
            
        }
    }

    async importWalletFromFile(pathAndFilename){
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
                              this.name = wallet.name;
                              _(this).passwordHash = wallet.passwordHash;
                              _(this).locked = true;
                              resolve(this);
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