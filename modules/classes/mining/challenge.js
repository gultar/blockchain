
const { logger } = require('../../tools/utils')

process.DIFFICULTY_BOMB_DIVIDER = 100000; //blocks
process.IDEAL_BLOCK_TIME = 10; //seconds
const MINIMUM_DIFFICULTY = parseInt('0x100000')

class Difficulty{
  constructor(genesisConfig){
    this.blockTime = genesisConfig.blockTime || 20
    this.difficultyBomb = genesisConfig.difficultyBomb || 100 * 1000;
    this.minimumDifficulty = (typeof genesisConfig.difficulty == 'string' ? parseInt(genesisConfig.difficulty, 16) : genesisConfig.difficulty)
    this.difficultyBoundDivider = genesisConfig.difficultyBoundDivider || 512
    this.difficultyDivider = BigInt(384) //Has to be a big int
  }

  setNewDifficulty(previousBlock, newBlock){
    let debug = require('debug')('difficulty')
    const minimumDifficulty = BigInt(this.minimumDifficulty);
    debug('Minimum diff', minimumDifficulty)
    const mineTime = Math.floor((newBlock.timestamp - previousBlock.timestamp) / 1000);
    debug('Mine time difference', mineTime)
    const timeAdjustment = (this.blockTime - mineTime >= -99? (this.blockTime - mineTime) : -99)
    debug('Time adjustment', timeAdjustment)
    const modifier = (BigInt(parseInt(previousBlock.difficulty, 16)) / this.difficultyDivider) * BigInt(timeAdjustment)
    debug('Modifier', modifier)
    const difficultyBomb = BigInt(Math.floor(Math.pow(2, Math.floor(previousBlock.blockNumber / this.difficultyBomb)-2)))
    let blockDiff = BigInt(parseInt(previousBlock.difficulty, 16)) + modifier + difficultyBomb
    debug('Block diff', blockDiff)
    blockDiff = (blockDiff > minimumDifficulty ? blockDiff : minimumDifficulty)
    return BigInt(blockDiff).toString(16)
  }

  setNewChallenge(block){
    let difficulty = BigInt(parseInt(block.difficulty, 16))
    if(difficulty == BigInt(0)) difficulty = BigInt(1)
    let newChallenge = BigInt(Math.pow(2, 255) -1) / BigInt(difficulty)
    return newChallenge.toString(16)
  }
}


/**
  Algorithm to increase difficulty over time to ensure uniform block time.
  To be worked on.
  @param {number} $currentChallenge - Mining difficulty current set on blockchain
  @param {number} $lastTimestamp - Time of block creation expressed in milliseconds
  @param {number} $newTimestamp - Time at the end of the block creation process in milliseconds
*/

// function setNewDifficulty(previousBlock, newBlock){
//   const mineTime = (newBlock.timestamp - previousBlock.timestamp) / 1000;
//   let adjustment = 1;
//   let minimumDifficulty = BigInt(MINIMUM_DIFFICULTY);//'0x100000';
//   if(mineTime > 0 && mineTime <= 1){
//     adjustment = 15
//   }else if(mineTime > 1 && mineTime <= 5){
//     adjustment = 10
//   }else if(mineTime > 5 && mineTime <= 10){
//     adjustment = 5
//   }else if(mineTime > 10 && mineTime <= 20){
//     adjustment = 0;
//   }else if(mineTime > 20 && mineTime <= 30){
//     adjustment = 0
//   }else if(mineTime > 30 && mineTime <= 40){
//     adjustment = -1
//   }else if(mineTime > 40 && mineTime <= 50){
//     adjustment = -2
//   }else if(mineTime > 50 && mineTime <= 60){
//     adjustment = -4
//   }else if(mineTime > 60 && mineTime <= 70){
//     adjustment = -5
//   }else if(mineTime > 70){
//     adjustment = -10
//   }
//   // if(mineTime < 15 || mineTime > 30){
//   //   adjustment = Math.floor(30 - mineTime);
//   // }else{
//   //   adjustment = 0;
//   // }
  
  
//   let difficulty = BigInt(parseInt(previousBlock.difficulty, 16))
//   let difficultyBomb = BigInt(Math.floor(Math.pow(2, Math.floor((previousBlock.blockNumber / process.DIFFICULTY_BOMB_DIVIDER)-2))))
//   difficultyBomb = ( adjustment > 0 && difficultyBomb > 0 ? difficultyBomb : 1 )
//   // let modifier = Math.max(1 - Math.floor(mineTime / 10), -99)
//   // let modifier = BigInt(difficulty / 32n) * BigInt(adjustment)
//   // if(modifier < 0){
//   //   modifier = (modifier * -1n <= difficulty ? modifier : modifier / 10n)
//   // }
//   let newDifficulty = BigInt(difficulty) + (BigInt(difficulty/32n) * BigInt(adjustment) * BigInt(difficultyBomb)) 
//   newDifficulty = (newDifficulty > minimumDifficulty ? newDifficulty : minimumDifficulty)
//   setDifficulty(previousBlock, newBlock)
//   return BigInt(newDifficulty).toString(16);
// }

const setNewDifficulty =(previousBlock, newBlock)=>{
  const minimumDifficulty = BigInt(MINIMUM_DIFFICULTY);
  // console.log('Minimum difficulty: ', minimumDifficulty)
  const mineTime = Math.floor((newBlock.timestamp - previousBlock.timestamp) / 1000);
  // console.log('Mine time:', mineTime)
  const timeAdjustment = (20 - mineTime >= -99? (20 - mineTime) : -99)
  // console.log('Time adjustment:', timeAdjustment)
  const modifier = (BigInt(parseInt(previousBlock.difficulty, 16)) / BigInt(512)) * BigInt(timeAdjustment)
  // console.log('Modifier:', modifier)
  const difficultyBomb = BigInt(Math.floor(Math.pow(2, Math.floor(previousBlock.blockNumber / 100000)-2)))
  // console.log('Difficulty bomb', difficultyBomb)
  let blockDiff = BigInt(parseInt(previousBlock.difficulty, 16)) + modifier + difficultyBomb
  // console.log(`${BigInt(parseInt(previousBlock.difficulty, 16))} + ${modifier} + ${difficultyBomb}`)
  // console.log('New Difficulty:', blockDiff)
  blockDiff = (blockDiff > minimumDifficulty ? blockDiff : minimumDifficulty)
  return BigInt(blockDiff).toString(16) //console.log('Possible difficulty: ', blockDiff)
}

const setNewChallenge = (block) =>{
  let difficulty = BigInt(parseInt(block.difficulty, 16))
  if(difficulty == BigInt(0)) difficulty = BigInt(1)
  let newChallenge = BigInt(Math.pow(2, 255) -1) / BigInt(difficulty)
  return newChallenge.toString(16)
}


module.exports = {setNewChallenge, setNewDifficulty, Difficulty};