const ethers = require('ethers');
const ethersDestructured = require('ethers').ethers;

console.log('require("ethers") keys:', Object.keys(require('ethers')));
console.log('ethers const:', typeof ethers, ethers ? Object.keys(ethers).slice(0, 5) : 'null');
console.log('ethers destructured:', typeof ethersDestructured);

try {
    const provider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org/');
    const wallet = ethers.Wallet.createRandom(provider);
    console.log('Wallet created');
    if (wallet.getNonce) console.log('wallet.getNonce exists');
    else console.log('wallet.getNonce MISSING');

    if (wallet.getTransactionCount) console.log('wallet.getTransactionCount exists');
    else console.log('wallet.getTransactionCount MISSING');
} catch (e) {
    console.error('Error:', e.message);
}
