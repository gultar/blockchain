const Validator = require('jsonschema').Validator;
const schemaDebug = require('debug')('schema')
const fetchErrors = (errors) =>{
    let errorMessages = {}
    for(let error of errors){
        if(error.message){
            errorMessages[error.argument] = error.message
        }
    }

    return errorMessages;
    
}

const isValidTransactionJSON = (transaction)=>{
    var v = new Validator();
    
    var schema = {
        "id":"/transaction",
        "type": "object",
        "properties": {
            "fromAddress": {"type": "string"},
            "toAddress": {"type": "string"},
            "amount": {"type": "number"},
            "data": {"type": [
                "string","object"
            ]},
            "timestamp":{"type":"number"},
            "hash":{"type":"string"},
            "type":{"type":"string"},
            "signature":{"type":"string"}
        },
        "required": ["fromAddress", "toAddress", "amount", "timestamp", "hash", "signature"]
    };

    if(transaction){
        v.addSchema(schema, "/transaction")
        let valid = v.validate(transaction, schema);
        if(valid.errors.length == 0){
            return true
        }else{
            return false;
        }
        
    }
}

const isValidTransactionCallJSON = (transaction)=>{
    var v = new Validator();
    
    var schema = {
        "id":"/transaction",
        "type": "object",
        "properties": {
            "fromAddress": {"type": "string"},
            "toAddress": {"type": "string"},
            "amount": {"type": "number"},
            "data": {"type": [
                "string","object"
            ]},
            "timestamp":{"type":"number"},
            "hash":{"type":"string"},
            "type":{"type":"string"},
            "signature":{"type":"string"}
        },
        "required": ["fromAddress", "toAddress", "timestamp", "hash", "type"]
    };

    if(transaction){
        v.addSchema(schema, "/transaction")
        let valid = v.validate(transaction, schema);
        if(valid.errors.length == 0){
            return true
        }else{
            return false;
        }
        
    }
}

const isValidContractActionJSON = (contractAction)=>{
    var v = new Validator();
    
    var schema = {
        "id":"/contractAction",
        "type": "object",
        "properties": {
            "fromAccount": {"type": "string"},
            "type": {"type": "string"},
            "task": {"type": "string"},
            "data": {"type": [
                "string","object"
            ]},
            "fee":{"type":"number"},
            "timestamp":{"type":"number"},
            "hash":{"type":"string"},
            "signature":{"type":"string"},
            "actionReference":{"type":"object"}
        },
        "required": ["fromAccount", "type", "task", "fee", "timestamp", "hash", "actionReference"]
    };

    if(contractAction){
        v.addSchema(schema, "/contractAction")
        let valid = v.validate(contractAction, schema);
        if(valid.errors.length == 0){
            return true
        }else{
            return false;
        }
        
    }
}

const isValidPayableJSON = (payable)=>{
    var v = new Validator();
    
    var schema = {
        "id":"/payable",
        "type": "object",
        "properties": {
            "fromAddress": {"type": "string"},
            "toAddress": {"type": "string"},
            "amount": {"type": "number"},
            "data": {"type": [
                "string","object"
            ]},
            "timestamp":{"type":"number"},
            "hash":{"type":"string"},
            "type":{"type":"string"},
            "reference":{"type":"object"},
            "signature":{"type":"string"},
            "fromContract":{"type":"string"},
            "miningFee":{"type":"number"}
        },
        "required": ["fromAddress", "toAddress", "type", "timestamp", "hash", "reference", "fromContract"]
    };

    if(payable){
        v.addSchema(schema, "/payable")
        let valid = v.validate(payable, schema);
        if(valid.errors.length == 0){
            return true
        }else{
            return false;
        }
        
    }
}

const isValidCallPayloadJSON = (callPayload, returnErrors)=>{
    var v = new Validator();
    
    var schema = {
        "id":"/callPayload",
        "type": "object",
        "properties": {
            "contractName": {"type": "string"},
            "method":{"type":"string"},
            "cpuTime":{"type":["number","string"]},
            "params":{"type":"object"},
        },
        "required": ["contractName", "method", "cpuTime", "params"]
    };

    if(callPayload){
        v.addSchema(schema, "/callPayload")
        let valid = v.validate(callPayload, schema);
        if(valid.errors.length == 0){
            return true
        }else{
            console.log(valid.errors)
            if(returnErrors) return valid.errors
            else return false;
        }
        
    }
}

const isValidActionJSON = (action)=>{
    var v = new Validator();
    var schema = {
        "id":"/action",
        "type": "object",
        "properties": {
            "fromAccount": {"type": "string"},
            "type": {"type": "string"},
            "task": {"type": "string"},
            "data": {"type": [
                "string","object"
            ]},
            "fee":{"type":"number"},
            "timestamp":{"type":"number"},
            "hash":{"type":"string"},
            "signature":{"type":"string"}
        },
        "required": ["fromAccount", "type", "task", "fee", "timestamp", "hash", "signature"]
    };

    if(action){
        v.addSchema(schema, "/action")
        let valid = v.validate(action, schema);
        // if(process.JSONDEBUG == true) console.log(valid)
        if(valid.errors.length == 0){
            return true
        }else{
            console.log(valid.errors)
            return false;
        }
        
    }
}

const isValidContractDeployJSON = (deployResult)=>{
    var v = new Validator();
    var schema = {
        "id":"/contractDeploy",
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "contractAPI": {"type": "object"},
            "state": {"type": "object"},
        },
        "required": ["name", "contractAPI"]
    };

    if(deployResult){
        v.addSchema(schema, "/contractDeploy")
        let valid = v.validate(deployResult, schema);
        if(valid.errors.length == 0){
            return true
        }else{
            return false;
        }
        
    }
}

const isValidAccountJSON = (account)=>{
    var v = new Validator();
    var schema = {
        "id":"/account",
        "type": "object",
        "properties": {
            "name": {"type":"string"},
            "ownerKey": {"type": "string"},
            "hash": {"type": "string"},
            "ownerSignature": {"type": "string"},
        },
        "required": ["name", "ownerKey", "hash", "ownerSignature"]
    };

    if(account){
        v.addSchema(schema, "/account")
        let valid = v.validate(account, schema);
        
        if(valid.errors.length == 0){
            return true
        }else{
            return false;
        }
        
    }
}

const isValidChainLengthJSON = (transaction)=>{
    var v = new Validator();
    var schema = {
        "id":"/chainLength",
        "type": "object",
        "properties": {
            "length": {"type": "number"},
            "peerAddress": {"type": "string"},
        },
        "required": ["length", "peerAddress"]
    };

    if(transaction){
        v.addSchema(schema, "/transaction")
        let valid = v.validate(transaction, schema);
        if(valid.errors.length == 0){
            return true
        }else{
            return false;
        }
        
    }
}



const isValidWalletRequestJSON = (transaction)=>{
    var v = new Validator();
    var schema = {
        "id":"/walletRequest",
        "type": "object",
        "properties": {
            "name": {"type": "string"},
        },
        "required": ["name"]
    };

    if(transaction){
        v.addSchema(schema, "/transaction")
        let valid = v.validate(transaction, schema);
        if(valid.errors.length == 0){
            return true
        }else{
            return false;
        }
        
    }
}

const isValidWalletBalanceJSON = (transaction)=>{
    var v = new Validator();
    var schema = {
        "id":"/walletBalance",
        "type": "object",
        "properties": {
            "publicKey": {"type": "string"},
        },
        "required": ["publicKey"]
    };

    if(transaction){
        v.addSchema(schema, "/transaction")
        let valid = v.validate(transaction, schema);
        if(valid.errors.length == 0){
            return true
        }else{
            return false;
        }
        
    }
}

const isValidCreateWalletJSON = (transaction)=>{
    var v = new Validator();
    var schema = {
        "id":"/createWallet",
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "password": {"type":"string"},
        },
        "required": ["name", "password"]
    };

    if(transaction){
        v.addSchema(schema, "/transaction")
        let valid = v.validate(transaction, schema);
        if(valid.errors.length == 0){
            return true
        }else{
            return false;
        }
        
    }
}

const isValidUnlockWalletJSON = (transaction)=>{
    var v = new Validator();
    var schema = {
        "id":"/unlockWallet",
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "password": {"type":"string"},
        },
        "required": ["name", "password"]
    };

    if(transaction){
        v.addSchema(schema, "/transaction")
        let valid = v.validate(transaction, schema);
        if(valid.errors.length == 0){
            return true
        }else{
            return false;
        }
        
    }
}



const isValidGetNextBlockJSON = (blockRequest) =>{
    var v = new Validator();

    

    var blockRequestSchema = {
        "id":"/getNextBlock",
        "type": "object",
        "properties": {
            "hash": {"type": "string"},
            "header":{"type":"string"}

        },
        "required": ["hash", "header"]
    };

    

    if(blockRequest){
        v.addSchema(blockRequestSchema, "/getNextBlock")
        let valid = v.validate(blockRequest, blockRequestSchema);
        
        if(valid.errors.length == 0){
            return true
        }else{
            return false;
        }
        
    }
}

const isValidHeaderJSON = (header)=>{
    var v = new Validator();
    var headerSchema = {
        "id":"/header",
        "type":"object",
        "header":{"type":"object"},
            "properties":{
                "blockNumber":{"type":"number"},
                "timestamp":{"type":"number"},
                "previousHash":{"type":"string"},
                "hash":{"type":"string"},
                "nonce":{"type":"number"},
                "merkleRoot":{"type":"string"},
                "actionMerkleRoot":{"type":"string"},
                "txHashes":{"type":"array"},
            },
        "required": ["blockNumber", "timestamp", "previousHash", "hash", "nonce", "merkleRoot"]
    }

    if(header){
        v.addSchema(headerSchema, "/header")
        let valid = v.validate(header, headerSchema);
        if(valid.errors.length == 0){
            return true
        }else{
            console.log(valid.errors)
            return false;
        }
        
    }else{
        return false
    }
}

const isValidBlockJSON = (header)=>{
    var v = new Validator();
    var headerSchema = {
        "id":"/block",
        "type":"object",
        "header":{"type":"object"},
            "properties":{
                "blockNumber":{"type":"number"},
                "timestamp":{"type":"number"},
                "previousHash":{"type":"string"},
                "hash":{"type":"string"},
                "nonce":{"type":"number"},
                "merkleRoot":{"type":"string"},
                "actionMerkleRoot":{"type":"string"},
                "challenge":{"type":"string"},
                "transactions":{"type":"object"},
                "actions":{"type":"object"},
                "difficulty":{"type":"string"}
            },
        "required": [
            "blockNumber", 
            "timestamp", 
            "previousHash",
            "hash", 
            "nonce", 
            "merkleRoot", 
            "challenge",
            "difficulty",
            "transactions",
        ]
    }

    if(header){
        v.addSchema(headerSchema, "/block")
        let valid = v.validate(header, headerSchema);
        if(valid.errors.length == 0){
            return true
        }else{
            console.log(valid.errors)
            return false;
        }
        
    }
}

const isValidGenesisBlockJSON = (header)=>{
    var v = new Validator();
    var headerSchema = {
        "id":"/block",
        "type":"object",
        "header":{"type":"object"},
            "properties":{
                "blockNumber":{"type":"number"},
                "timestamp":{"type":"number"},
                "previousHash":{"type":"string"},
                "hash":{"type":"string"},
                "nonce":{"type":"number"},
                "merkleRoot":{"type":"string"},
                "actionMerkleRoot":{"type":"string"},
                "challenge":{"type":"string"},
                "actions":{"type":"object"},
                "difficulty":{"type":"string"},
                "balances":{"type":"object"}
            },
        "required": [
            "blockNumber", 
            "timestamp", 
            "previousHash",
            "hash", 
            "nonce", 
            "merkleRoot", 
            "challenge",
            "difficulty",
        ]
    }

    if(header){
        v.addSchema(headerSchema, "/block")
        let valid = v.validate(header, headerSchema);
        if(valid.errors.length == 0){
            return true
        }else{
            console.log(valid.errors)
            return false;
        }
        
    }
}

const isValidBlockchainStatusJSON = (blockchainStatus)=>{
    var v = new Validator();
    const statusDebug = require('debug')('status')
    var headerSchema = {
        "id":"/header",
        "type":"object",
        "header":{"type":"object"},
            "properties":{
                "blockNumber":{"type":"number"},
                "timestamp":{"type":"number"},
                "previousHash":{"type":"string"},
                "hash":{"type":"string"},
                "nonce":{"type":"number"},
                "merkleRoot":{"type":"string"},
                "actionMerkleRoot":{"type":"string"},
                "txHashes":{"type":"array"},
            },
        "required": ["blockNumber", "timestamp", "previousHash", "hash", "nonce", "merkleRoot"]
    }
    var schema = {
        "id":"/blockchainStatus",
        "type": "object",
        "properties": {
            "totalDifficultyHex": {"type": "string"},
            "bestBlockHeader": {"$ref": "/header"},
        },
        "required": ["totalDifficultyHex", "bestBlockHeader"]
    };

    if(blockchainStatus){
        v.addSchema(headerSchema, "/header")
        v.addSchema(schema, "/blockchainStatus")
        let valid = v.validate(blockchainStatus, schema);
        if(valid.errors.length == 0){
            return true
        }else{
            statusDebug('Status Debug:', valid.errors)
            return false;
        }
        
    }
}

module.exports = { 
    isValidTransactionJSON,
    isValidTransactionCallJSON,
    isValidCallPayloadJSON, 
    isValidChainLengthJSON, 
    isValidWalletRequestJSON, 
    isValidGetNextBlockJSON,
    isValidHeaderJSON,
    isValidCreateWalletJSON,
    isValidUnlockWalletJSON,
    isValidWalletBalanceJSON,
    isValidActionJSON,
    isValidAccountJSON,
    isValidBlockJSON,
    isValidGenesisBlockJSON,
    isValidContractActionJSON,
    isValidPayableJSON,
    isValidBlockchainStatusJSON
 };