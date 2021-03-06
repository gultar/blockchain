const NetworkConfig = require('./netConfig')
const NetworkToken = require('./networkToken')
const genesis = require('../tools/getGenesis')
const { saveGenesisFile } = require('../classes/genesisBlock')
const { readFile, writeToFile, logger } = require('../tools/utils')

class NetworkManager{
    constructor(network){
        this.genesis = genesis
        this.currentNetwork = network || genesis.network || 'mainnet'
        this.configs = {}
    }

    async init(){
        try{
            this.configs = new NetworkConfig(this.currentNetwork)
            let loaded = await this.configs.loadNetworkConfig()
            if(loaded){
                if(loaded.error) return { error:loaded.error }
                let joined = await this.joinNetwork(loaded)
                if(joined.error) return { error:joined.error }

                return loaded
            }else{
                return { error:'ERROR: Could not initialize network manager' }
            }
        }catch(e){
            return { error:e.message }
        }
        
    }

    async createNetwork(config){
        if(!config) config = genesis
        let token = new NetworkToken(config)
        let newGenesis = token.genesisConfig
        let savedGenesis = await saveGenesisFile(newGenesis)
        let saved = await this.saveConfig(token)
        if(savedGenesis.error) return { error:savedGenesis.error }
        else return savedGenesis
    }

    async addNetwork(networkToken){
        return await this.configs.joinNetwork(networkToken)
    }

    getNetwork(network=this.currentNetwork){
        let networkToken = this.configs.getNetwork(network)
        return networkToken
    }

    async joinNetwork(token){
        let newGenesis = token.genesisConfig
        let savedGenesis = await saveGenesisFile(newGenesis)
        process.GENESIS = newGenesis
        let saved = this.save('silent')
        if(saved.error || savedGenesis.error) return { error:saved.error || savedGenesis.error } 
        else return saved
    }

    async saveConfig(token){
        let written = await writeToFile(token, `./config/${token.network}.json`)
        if(written){
            if(written.error) return { error:written.error }
            else return written
        }else{
            return { error:`ERROR: Could not write config file for ${token.network}` }
        }
    }

    async save(silent=false){
        if(!silent) logger('Saving network configurations')
        return await this.configs.saveNetworkConfig()
    }
}

module.exports = NetworkManager