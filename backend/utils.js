const sha256 = require('./sha256');
const merkle = require('merkle');
const fs = require('fs')

const displayTime = () =>{
  let date = new Date();
  let time = date.toLocaleTimeString();
  return time;
}

const logger = (message, arg) => {
  let date = new Date();
  let time = date.toLocaleTimeString();
  let beautifulMessage = `[${time}] ${message}`//'['+ time +'] ' + message;
  if(arg){
    console.log(beautifulMessage, arg);
  }else{
    console.log(beautifulMessage);
  }
}


function RecalculateHash(block){

  return sha256(block.previousHash + block.timestamp + block.merkleRoot + block.nonce).toString();
}

function merkleRoot(dataSets){

  if(dataSets != undefined){
    var hashes = Object.keys(dataSets);


    let merkleRoot = merkle('sha256').sync(hashes);
    return merkleRoot.root();
  }

}

const encrypt = (text, password) =>{
  var cipher = crypto.createCipher(algorithm,password)
  var crypted = cipher.update(text,'utf8','hex')
  crypted += cipher.final('hex');
  return crypted;
}

const decrypt = (text, password) =>{
  var decipher = crypto.createDecipher(algorithm,password)
  var dec = decipher.update(text,'hex','utf8')
  dec += decipher.final('utf8');
  return dec;
}

const readFile = async (filename) =>{
  return new Promise((resolve, reject)=>{
    fs.exists(filename,(exists)=>{
      if(exists){
        var data = '';
        var rstream = fs.createReadStream(filename);
    
        rstream.on('error', (err) =>{
          logger(err);
          resolve(err)
        })
    
        rstream.on('data', (chunk) => {
          data += chunk;
        });
    
    
        rstream.on('close', () =>{  // done
          if(data != undefined){
              resolve(data);
          }else{
            resolve(false);
          }
        });
      }else{
        resolve(false);
      }
    })

  })
  
}

const writeToFile = (data, filename) =>{
  return new Promise((resolve, reject)=>{
    fs.exists(filename, async (exists)=>{
      
      if(exists){       
        let file = parseToString(data);
          if(file != undefined){

            var stream = fs.createWriteStream(filename);

            stream.write(file);
            stream.end();
            stream.on('finish', () => {
              resolve(true)
            });
            
            stream.on('error', (error) => {
              logger(error);
              resolve(false)
            });

          }else{
            resolve(false)
          }
  
      }else{
        logger('WARNING: File inexistant. Creating it right now')
        resolve(await createFile(data, filename))
      }
    });
  })

}

const parseToString = (data)=>{
  let typeOfData = typeof data;
  let file = data;

  switch(typeOfData){
    case 'string':
      break;
    case 'function':
    case 'object':
      try{
        file = JSON.stringify(data, null, 2);
      }catch(e){
        logger(e);
      }
      break;
    case 'number':
      file = data.toString();
      break;
    default:
      logger('ERROR: could not write this data type');
      break;

  }

  return file
}

const createFile = (data, filename) =>{
  return new Promise((resolve, reject)=>{
    let file = parseToString(data);
    fs.exists(filename, async (exists)=>{
      if(!exists){
        var stream = fs.createWriteStream(filename);
        stream.write(file);
        stream.end()
        stream.on('finish', () => {
          resolve(true)
        });
        
        stream.on('error', (error) => {
          logger(error);
          resolve(false)
        });
      }else{
        logger('WARNING: file already exists');
        resolve(await writeToFile(data, filename))
        
      }
    })
  })
  
}



module.exports = { 
  displayTime, 
  logger, 
  RecalculateHash, 
  merkleRoot, 
  encrypt, 
  decrypt,
  readFile,
  writeToFile,
  createFile };
