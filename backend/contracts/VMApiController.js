const EventEmitter = require('events')

const vmMaster = ({ codes, isDeployment }) =>{
    return new Promise(async (resolve)=> {
        let pushResult = new EventEmitter()
        let calls = {}
        let results = {}
        let lifeCycles = 0
        let limitLifeCycles = 10 // 
        let pingCounter = 0;
        let child = require('child_process').fork(`./backend/contracts/VMApi.js`,{
            execArgv: ['--max-old-space-size=512']  
        })
        
        if(codes){
            for await(let contractName of Object.keys(codes)){
                if(contractName !== 'totalCalls'){
                    let state = codes[contractName].state
                    let contract = codes[contractName].contract
                    if(state && contract){
                        child.send({nextState:state})
                        child.send({contractCode:contract.code, contractName:contractName}) 
                        calls = codes[contractName].calls
                    }else{
                        //Need to change the way I handle too many transaction calls
                        child.kill()
                    }
                } 
            }
    
            for await(let hash of Object.keys(calls)){
                
                let code = calls[hash].code
                let contractName = calls[hash].contractName
                let methodToRun = calls[hash].methodToRun
                child.send({code:code, contractName:contractName, methodToRun:methodToRun, hash:hash})
            }
        }else if(isDeployment){
            let contract = isDeployment.contract;
            if(!contract) resolve({error:'Cannot deploy unknown contract'})
            
            child.send({ contractToDeploy: contract })
        }

        let keepAlive = setInterval(()=>{
            lifeCycles++
            pingCounter++;
            if(lifeCycles >= limitLifeCycles && pingCounter >= limitLifeCycles){
                child.kill()
                clearInterval(keepAlive)
                if(Object.keys(results).length > 0){
                    child.kill()
                    resolve(results)
                }else{
                    resolve({error:'VM ERROR: VM finished its lifecycle'})
                }
            }
        }, 50)
        child.on('message', (message)=>{
            if(message.executed){
                pingCounter = 0;
                lifeCycles = 0;
                results[message.hash] = {
                    executed:message.executed,
                    contractName:message.contractName
                }
                pushResult.emit('callResult', {
                    executed:message.executed,
                    contractName:message.contractName
                })
            }else if(message.error){
                console.log('VM ERROR:',message)
                child.kill()
                clearInterval(keepAlive)
                resolve({error:message.error})
            }else{
                console.log('Message:', message)
                child.kill()
                clearInterval(keepAlive)
                resolve({error:'VM ERROR: Invalid VM response message'})
            }
        })

        child.on('error', function(data) {
            console.log('stderr: ' + data);
            clearInterval(keepAlive)
            resolve({error:'A VM error occurred'})
        });
        child.on('close', function() { clearInterval(keepAlive) })
        
        resolve(pushResult)


    })
    
    
}

module.exports = vmMaster;