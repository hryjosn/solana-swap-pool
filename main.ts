import {
  TokenSwap,
  TOKEN_SWAP_PROGRAM_ID,
  TokenSwapLayout,
  CurveType,
} from "@solana/spl-token-swap";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as token from "@solana/spl-token";

import fs from "fs";


const connect = async () => {
  const connection: Connection = new Connection(
    clusterApiUrl("devnet"),
    "confirmed"
  );
  return connection;
};

const loadKeyPair = (filename: string) => {
  const secret = JSON.parse(fs.readFileSync(filename).toString()) as number[];
  const secretKey = Uint8Array.from(secret);
  return Keypair.fromSecretKey(secretKey);
};

const createATAInstruction = async (
  payer: PublicKey,
  owner: PublicKey,
  tokenAddress: PublicKey
): Promise<[PublicKey, TransactionInstruction]> => {
  const tokenTAAddress: PublicKey = await token.getAssociatedTokenAddress(
    tokenAddress,
    owner,
    true // allow owner off curve
  );

  const tokenAccountInstruction: TransactionInstruction =
    await token.createAssociatedTokenAccountInstruction(
      payer, // payer
      tokenTAAddress, // ata
      owner, // owner
      tokenAddress // mint
    );

  return [tokenTAAddress, tokenAccountInstruction];
};

const createLPToken = async (wallet: Keypair, swapAuthority: PublicKey) => {
  try {
    const connection = await connect();
    const poolTokenMint = await token.createMint(
      connection,
      wallet,
      swapAuthority,
      null,
      2
    );
    return poolTokenMint;
  } catch (err) {
    console.log("createLPTokenErr", err);
  }
};

const createTokenPoolAccount = async (
  tokenAccountPool: Keypair,
  wallet: Keypair,
  poolTokenMint: PublicKey
): Promise<[TransactionInstruction, TransactionInstruction]> => {
  const connection = await connect();
  const poolAccountRent =
    await token.getMinimumBalanceForRentExemptAccount(connection);
  const createTokenAccountPoolInstruction = SystemProgram.createAccount({
    fromPubkey: wallet.publicKey,
    newAccountPubkey: tokenAccountPool.publicKey,
    space: token.ACCOUNT_SIZE,
    lamports: poolAccountRent,
    programId: token.TOKEN_PROGRAM_ID,
  });

  const initializeTokenAccountPoolInstruction =
    token.createInitializeAccountInstruction(
      tokenAccountPool.publicKey,
      poolTokenMint,
      wallet.publicKey
    );

  return [
    createTokenAccountPoolInstruction,
    initializeTokenAccountPoolInstruction,
  ];
};

const getTokenBalance = async (associatedTokenAccount: PublicKey) => {
  const connection = await connect();
  const tokenBalance = await connection.getTokenAccountBalance(
    associatedTokenAccount
  );
  return Number(tokenBalance.value.amount);
};

const loadKeys = (): [Keypair, Keypair, Keypair, PublicKey] => {
  const tokenSwapStateAccount = loadKeyPair(
    "./TSBCG895nuhG4KnrTTqVf3z5bb9WjAfffTou5drcE3E.json"
  );
  const wallet = loadKeyPair(
    "./Hyd91h5FeqBhNfBjEvxB5X3rNuixeGCeLdJqoMA1Kz1R.json"
  );
  const tokenAccountPool = loadKeyPair(
    "./TPA5UAhnFQ2REeprk9gQ9GtLemmt7YnavTAWktgmb7h.json"
  );
  const feeOwner = new PublicKey(
    "HfoTxFR1Tm6kGmWgYWD6J7YHVy1UwqSULUGVLXkJqaKN"
  );

  return [tokenSwapStateAccount, wallet, tokenAccountPool, feeOwner];
};

const createSwapAuthority = async (tokenA: string, tokenB: string) => {
  try {
    let transaction = new Transaction();
    const [tokenSwapStateAccount, wallet] = loadKeys();
    // holds information about the swap pool
    const connection = await connect();
    const rent =
      await TokenSwap.getMinBalanceRentForExemptTokenSwap(connection);

    const tokenSwapStateAccountCreationInstruction =
      await SystemProgram.createAccount({
        newAccountPubkey: tokenSwapStateAccount.publicKey,
        fromPubkey: wallet.publicKey,
        lamports: rent,
        space: TokenSwapLayout.span,
        programId: TOKEN_SWAP_PROGRAM_ID,
      });

    transaction.add(tokenSwapStateAccountCreationInstruction);

    const [swapAuthority, bump] = await PublicKey.findProgramAddressSync(
      [tokenSwapStateAccount.publicKey.toBuffer()],
      TOKEN_SWAP_PROGRAM_ID
    );

    const TokenAMint = new PublicKey(tokenA);
    const TokenBMint = new PublicKey(tokenB);

    const [tokenAATAAccount, tokenAAccountInstruction] =
      await createATAInstruction(wallet.publicKey, swapAuthority, TokenAMint);
    transaction.add(tokenAAccountInstruction);

    const [tokenBATAAccount, tokenBAccountInstruction] =
      await createATAInstruction(wallet.publicKey, swapAuthority, TokenBMint);
    transaction.add(tokenBAccountInstruction);

    // const tx1 = await sendAndConfirmTransaction(connection, transaction, [
    //   wallet,
    //   tokenSwapStateAccount,
    // ]);
    // console.log("tx1", tx1);
    console.log("tokenAATAAccountAddress", tokenAATAAccount.toBase58());
    console.log("tokenBATAAccountAddress", tokenBATAAccount.toBase58());
    console.log("swapAuthority", swapAuthority.toBase58());
  } catch (err) {
    console.log("createPoolError", err);
  }
};

const createPool = async (
  tokenAATAAccountAddress: string,
  tokenBATAAccountAddress: string,
  swapAuthoritAddress: string
) => {
  let transaction = new Transaction();

  const connection = await connect();
  const [tokenSwapStateAccount, wallet, tokenAccountPool, feeOwner] =
    loadKeys();

  const tokenAATAAccount = new PublicKey(tokenAATAAccountAddress);
  const tokenBATAAccount = new PublicKey(tokenBATAAccountAddress);

  const swapAuthority = new PublicKey(swapAuthoritAddress);

  const tokenABalance = await getTokenBalance(tokenAATAAccount);
  console.log("tokenABalance", tokenABalance);

  const tokenBBlance = await getTokenBalance(tokenBATAAccount);
  console.log("tokenBBlance", tokenBBlance);

  if (tokenABalance == 0 || tokenBBlance == 0) {
    return console.log("You do not have token to create Swap Pool");
  }

  const poolTokenMint = await createLPToken(wallet, swapAuthority);
  if (poolTokenMint == null) {
    return console.log("Error in poolTokenMint");
  }
  console.log("poolTokenMint", poolTokenMint.toBase58());

  const [
    createTokenAccountPoolInstruction,
    initializeTokenAccountPoolInstruction,
  ] = await createTokenPoolAccount(tokenAccountPool, wallet, poolTokenMint);

  transaction.add(createTokenAccountPoolInstruction);
  transaction.add(initializeTokenAccountPoolInstruction);

  const [tokenFeeAccountAddress, tokenFeeAccountInstruction] =
    await createATAInstruction(wallet.publicKey, feeOwner, poolTokenMint);

  transaction.add(tokenFeeAccountInstruction);

  const tokenSwapInitSwapInstruction = TokenSwap.createInitSwapInstruction(
    tokenSwapStateAccount, // Token swap state account
    swapAuthority, // Swap pool authority
    tokenAATAAccount, // Token A token account
    tokenBATAAccount, // Token B token account
    poolTokenMint, // Swap pool token mint
    tokenFeeAccountAddress, // Token fee account
    tokenAccountPool.publicKey, // Swap pool token account
    token.TOKEN_PROGRAM_ID, // Token Program ID
    TOKEN_SWAP_PROGRAM_ID, // Token Swap Program ID
    BigInt(0), // Trade fee numerator
    BigInt(10000), // Trade fee denominator
    BigInt(5), // Owner trade fee numerator
    BigInt(10000), // Owner trade fee denominator
    BigInt(0), // Owner withdraw fee numerator
    BigInt(0), // Owner withdraw fee denominator
    BigInt(5), // Host fee numerator
    BigInt(100), // Host fee denominator
    CurveType.ConstantProduct // Curve type
  );

  transaction.add(tokenSwapInitSwapInstruction);

  const tx2 = await sendAndConfirmTransaction(connection, transaction, [
    wallet,
    tokenAccountPool,
    tokenSwapStateAccount
  ]);
  console.log("tx2", tx2);
};

// const swapToken = async (swapAuthoritAddress: string) => {
//   const [tokenSwapStateAccount] = loadKeys();

//   const user = loadKeyPair(
//     "./Keys/USRHWJVJE7K3y7qmEp3GziU9w3uke35eBXF7QZ4h5X3.json"
//   );

//   const swapAuthority = new PublicKey(swapAuthoritAddress);

//   const swapInstruction = TokenSwap.swapInstruction(
//     tokenSwapStateAccount.publicKey,
//     swapAuthority,
//     wallet.publicKey,
//     userTokenA,
//     poolTokenA,
//     poolTokenB,
//     userTokenB,
//     poolMint,
//     feeAccount,
//     null,
//     TOKEN_SWAP_PROGRAM_ID,
//     TOKEN_PROGRAM_ID,
//     amount * 10 ** MintInfoTokenA.decimals,
//     0
//   );

//   transaction.add(swapInstruction);
// };

const main = () => {
  createSwapAuthority(
    "ATwd6FkqFpp2HUeLTK6SpNVzhZCTn7er5LAevKvkgDNi",
    "BTWb3YyHn8hwi5t5J3rwepVUz7uhXtr51E3DVYcgcShh"
  );
};

main();

//TokenA : ATwd6FkqFpp2HUeLTK6SpNVzhZCTn7er5LAevKvkgDNi
//TokenB : BTWb3YyHn8hwi5t5J3rwepVUz7uhXtr51E3DVYcgcShh

//Hyd91h5FeqBhNfBjEvxB5X3rNuixeGCeLdJqoMA1Kz1R