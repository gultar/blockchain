const makeExternal = require('makeExternal')
const getCurrentBlock = require('getCurrentBlock')
const ContractAction = require('ContractAction')
const deferExecution = require("deferExecution")
class FuckUp{
    constructor(fuck){
        this.contractAccount = fuck.contractAccount
        this.counter = 0
        this.fuck = fuck
        this.state = {
            fuck:"up"
        }
    }

    setState(state){
        this.state = state
    }

    fuckup(){
        let counter
        while(true){
            counter++
        }
    }

    boom(){
        let text = `oajwdoiajwdoijawdoiajwdoiajdoiajwdoiawjdoiawjdoaiwjdoiawjdoaiwjdoawijdoawijdoiawj`
        let explosion = text + text + text + text + text + text + text
        let nuclear = explosion + explosion + explosion + explosion + explosion + explosion
        let kaboom = ''
        while(true){
            kaboom = nuclear + nuclear + nuclear + nuclear + nuclear
        }
    }

    async test(params){
        console.log('Calling action', params.callingAction)
        console.log(await getCurrentBlock())
        return { okay:true }
    }

    async testDefer(params){
        
        let callingAction = params.callingAction
        console.log('Calling action', callingAction)
        let currentBlock = await getCurrentBlock()
        
        console.log('Contract Account', this.contractAccount)
        let contractAction = new ContractAction({ 
            fromAccount:this.contractAccount, 
            data:{
                contractName:this.contractAccount,//Self executing action is simply a deferred execution
                method:'test',
                params:{},
                cpuTime:60,
            },
            task:'call',
            delayToBlock:currentBlock.blockNumber + 2,
            actionReference:params.callingAction
        })
        console.log('Contract Action', contractAction)
        let deferred = await deferExecution(contractAction)
        console.log('Deferred: ',deferred)
        return deferred
    }

    getInterface(){
        let api = makeExternal({
            fuckup:{
                type:'set',
                args:[],
                description:'Fucks up real bad'
            },
            boom:{
                type:'set',
                args:[],
                description:'Boom chika chika boom boom'
            },
            test:{
                type:'set',
                args:[],
                description:'test'
            },
            testDefer:{
                type:'set',
                args:[],
                description:'test'
            }
        })

        return api
    }
}
