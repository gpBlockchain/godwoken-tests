const hardhat = require("hardhat")
const { assert } = require("chai")
const { RPC } = require("@ckb-lumos/toolkit")
const { ERC20_BYTECODE, ERC20_ABI } = require("../lib/sudtErc20Proxy")
const { isGwMainnetV1 } = require("../utils/network")

const { ethers } = hardhat;

describe("AutoCreateAccount", function () {
  if (isGwMainnetV1()) {
    return;
  }

  let rpc
  let owner
  let token
  before(async () => {
    const url = hardhat.network.config.url
    if (!url) {
      throw new Error("url not found")
    }
    rpc = new RPC(url);

    [owner] = await ethers.getSigners();
    token = await hardhat.waffle.deployContract(owner, { abi: ERC20_ABI, bytecode: ERC20_BYTECODE }, ["pckb", "pCKB", 10000, 1, 18])
    await token.deployed();
    console.log("Token deployed to:", token.address);
  })

  it("Auto create account if ckb balance > 0", async () => {
    const randomUser = new ethers.Wallet(ethers.Wallet.createRandom().privateKey, ethers.provider);
    console.log("random user address:", randomUser.address)
    const randomUserBalance = await ethers.provider.getBalance(randomUser.address);
    console.log("random user balance:", randomUserBalance)
    const ownerBalance = await ethers.provider.getBalance(owner.address);
    console.log("owner balance:", ownerBalance);

  
    const randomUserId = await ethAddressToAccountId(randomUser.address, rpc);
    console.log("random user id:", randomUserId)
    assert.isUndefined(randomUserId)
  
    const transferTx = await token.transfer(randomUser.address, (2000n * 10n**18n).toString());
    await transferTx.wait();
    const ownerBalanceAfterTransfer = await ethers.provider.getBalance(owner.address);
    console.log("owner balance after transfer:", ownerBalanceAfterTransfer);
    const nextFromBalance = await ethers.provider.getBalance(randomUser.address)
    console.log("random user balance after transfer:", nextFromBalance)
    const randomUserIdAfterTransfer = await ethAddressToAccountId(randomUser.address, rpc);
    console.log("random user id after transfer:", randomUserIdAfterTransfer)
    assert.isUndefined(randomUserIdAfterTransfer)
  
    const Storage = await ethers.getContractFactory("Storage");
    let storage;
    try {
      storage = await Storage.connect(randomUser).deploy();
    } catch (err) {
      if (err.message.includes("cannot estimate gas")) {
        const txRequest = Storage.connect(randomUser).getDeployTransaction();
        const gasPrice = await ethers.provider.getGasPrice();
        const args = {
          ...txRequest,
          gasPrice: gasPrice.toHexString(),
          from: randomUser.address,
        }
        console.log("estimate gas args:", args)
        const estimateResult = await ethers.provider.estimateGas(args);
        console.log("estimate gas result:", estimateResult)
      }
      throw err;
    }
    console.log("Storage deployed tx hash:", storage.deployTransaction.hash)
  
    const tx = await ethers.provider.getTransaction(storage.deployTransaction.hash);
    assert.isDefined(tx)
    assert.isNotNull(tx)
    const receipt = await ethers.provider.getTransactionReceipt(storage.deployTransaction.hash);
    assert.isNull(receipt)
  
    await storage.deployed();
    console.log("Storage deployed to:", storage.address)
  
    // get transaction receipt
    const storageDeployTxReceipt = await ethers.provider.getTransactionReceipt(storage.deployTransaction.hash);
    assert.isDefined(storageDeployTxReceipt)
    assert.isNotNull(storageDeployTxReceipt)
  
    const randomUserIdAfterDeploy = await ethAddressToAccountId(randomUser.address, rpc);
    console.log("random user id after deploy:", randomUserIdAfterDeploy)
    assert.isDefined(randomUserIdAfterDeploy)
    assert.isNotNull(randomUserIdAfterDeploy)
  });
});

function u32ToLE(num) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(num);
  return `0x${buf.toString("hex")}`;
}

async function ethAddressToAccountId(ethAddress, rpc) {
  if (ethAddress === "0x" || ethAddress === "0x" + "00".repeat(20)) {
    throw new Error("Eth address should not be empty or zero address");
  }

  if (!ethAddress.startsWith("0x") || ethAddress.length != 42) {
    throw new Error(`Eth address format error: ${ethAddress}`)
  }

  const ethRegistryAccountId = 2;
  const addressByteSize = 20;
  const registryAddress = "0x" + u32ToLE(ethRegistryAccountId).slice(2) + u32ToLE(addressByteSize).slice(2) + ethAddress.toLowerCase().slice(2)

  const scriptHash = await rpc.gw_get_script_hash_by_registry_address(registryAddress);
  if (scriptHash == null) {
    return undefined;
  }
  const accountId = await rpc.gw_get_account_id_by_script_hash(scriptHash);
  if (accountId == null) {
    return undefined;
  }
  return BigInt(accountId)
}
