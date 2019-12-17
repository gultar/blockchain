#!/usr/bin/env node

const Node = require('./node');
const program = require('commander');
const { logger, readFile } = require('./backend/tools/utils');
const fs = require('fs')
const genesis = require('./backend/tools/getGenesis')


let node;



const loadNodeConfig = () =>{
  return new Promise(async (resolve)=>{
    fs.exists('./config/nodesconfig.json', async (exists)=>{
      if(exists){
        let nodeConfigString = await readFile('./config/nodesconfig.json');
        try{
          if(nodeConfigString){
            let nodeConfig = JSON.parse(nodeConfigString);
            resolve(nodeConfig)
          }else{
            resolve(false)
          }
          
        }catch(e){
          logger(e)
        }
      }else{
        logger('ERROR: Inexisting file')
        resolve(false)
      }
    })
  })
  
}

const getIP = () =>{
  return new Promise((resolve)=>{
    const address = require('address')
    address(function (err, addrs) {
      if(err) resolve({error:err})
      else resolve(addrs.ip)
    });
  })
}

program
  .version('0.0.1')
  .usage('<value> [-options]')
  .description(
  `
  Possible other commands:

  wallet - For managing wallets and wallet states
  sendTx - For sending transactions from one wallet to another
  action - For creating and sending an action to a contract
  chain  - For querying the blockchain for information
  config - For updating node config file
  pool   - For managing transaction pool
  `
    )
  .option('-n, --hostname <hostname>', 'Specify node hostname')
  .option('-p, --port <port>', 'Specify node port')
  .option('-j, --join [network]', 'Joins network')
  .option('-s, --seeds <seeds>', 'Seed nodes to initiate p2p connections')
  .option('-v, --verbose', 'Enable transaction and network verbose')
  .option('-d, --peerDiscovery [type]', 'Enable peer discovery using various methods')
  .option('-t, --peerDiscoveryPort <port>', 'Enable peer discovery using various methods')
  .option('-l, --dhtDisconnectDelay <delay>', 'Length of time after which the node disconnects from dht network')
  .option('-m, --mine', 'Start a block miner child process alongside the node')
  .option('-w, --walletName <walletName>', 'Name of the miner wallet')
  .option('-k, --password <password>', 'Password needed to unlock wallet')

program
  .command('start')
  .usage('node blockchainCLI.js start --option [value]')
  .description('Starts blockchain node')
  .action(async ()=>{
    
    if(!program.hostname){
      let ip = await getIP()
      if(ip.error){
        console.log('IP ERROR: ', ip.error)
        
      }else{
        program.hostname = ip
      }
    }

    let configs = await loadNodeConfig();
      if(program.verbose){
        configs.verbose = true;
      }
    let discovery = {}
      if(program.peerDiscovery){
        
        switch(program.peerDiscovery){
          
          case 'local': 
            discovery = {
              local:true
            }
            break;
          case 'dht':
            discovery = {
              dht:true
            }
            break;
          default:
            discovery = {
              dht:true
            }
            break;
        }
      }

      node = new Node({
        host:program.hostname ? program.hostname : configs.host,
        port:program.port ? program.port : configs.port,
        verbose:configs.verbose,
        httpsEnabled:true,
        enableLocalPeerDiscovery:discovery.local,
        enableDHTDiscovery:discovery.dht,
        peerDiscoveryPort:parseInt(configs.port) - 2000,
        networkChannel:'blockchain-mainnet',
        noLocalhost:true,
        genesis:genesis
      })

     node.startServer()
     .then( started =>{
      if(started.error) throw new Error(started.error)

      if(program.join){
        node.joinPeers();
      }

      if(program.mine){
        let walletName = program.walletName;
        let walletPassword = program.password;
        if(!walletName || !walletPassword){
          console.log('Could not start miner process: missing walletName or password')
        }else{
          const { Worker } = require('worker_threads');
          let worker = new Worker(`
          let Miner = require('./backend/classes/minerTools/miner')
          let miner = new Miner({
              publicKey:'',
              verbose:false,
              keychain:{ name:"${program.walletName}", password:"${program.password}" }
          })
          miner.connect("${'http://localhost:'+node.minerPort}")`, { eval: true })
          
          worker.on('error', error => {
            console.log(error)
          })
          worker.on('exit', (message)=> logger('Miner closed with node'))
        }

        
      }
  
      if(program.seeds){
        let seeds = program.seeds.split(';')
        for(let seed of seeds){
          node.connectToPeer(seed);
        }
      }
     })
     
      
  });

program.parse(process.argv)

process.on('SIGINT', async () => {
  logger('Shutting down node and saving state');
  

  if(process.MINER){
    logger('Stopping miner');
    process.ACTIVE_MINER.kill()
  }

  node.chain.vmController.stop()

  // node.closeNode()
  
  let saved = await node.save()
  .catch(e=>{
     console.log(e)
     process.exit()
    })
  process.exit()

});

