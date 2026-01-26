const ethers = require('ethers');
require('dotenv').config();

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org/');
const wallet = new ethers.Wallet(process.env.BSC_KEYS.split(',')[0].trim(), provider);
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

const erc20ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

async function checkAndApprove() {
    const contract = new ethers.Contract(WBNB, erc20ABI, wallet);
    const allowance = await contract.allowance(wallet.address, PERMIT2);
    console.log(`Current Allowance: ${allowance}`);

    if (allowance == 0n) {
        console.log('Approving Permit2...');
        const tx = await contract.approve(PERMIT2, ethers.MaxUint256);
        console.log('Approve Tx:', tx.hash);
        await tx.wait();
        console.log('Approved!');
    } else {
        console.log('Already approved.');
    }
}

checkAndApprove().catch(console.error);
