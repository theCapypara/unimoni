#!/usr/bin/env ts-node
import {BigNumber, ethers} from "ethers";
import {Pool, Position} from "@uniswap/v3-sdk";
import {Token} from "@uniswap/sdk-core";
import {abi as IUniswapV3PoolABI} from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import {abi as INonfungiblePositionManager} from "@uniswap/v3-periphery/artifacts/contracts/interfaces/INonfungiblePositionManager.sol/INonfungiblePositionManager.json";
import {abi as IUniswapV3Factory} from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json";
import {ITokenReferenceResolver, PositionStats} from "./stats";

const provider = new ethers.providers.JsonRpcProvider(
    "https://mainnet.infura.io/v3/0f53c5edf2f04fa78cdd98e3e612eebc"
    //"http://kiwano:8545"
);

const nftPositionAddress = "0xc36442b4a4522e871399cd717abdd847ab11fe88";
const nftPositionContract = new ethers.Contract(
    nftPositionAddress,
    INonfungiblePositionManager,
    provider
);

const factoryAddress = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const factoryContract = new ethers.Contract(
    factoryAddress,
    IUniswapV3Factory,
    provider
);

interface Immutables {
    factory: string;
    token0: string;
    token1: string;
    fee: number;
    tickSpacing: number;
    maxLiquidityPerTick: ethers.BigNumber;
}

interface State {
    liquidity: ethers.BigNumber;
    sqrtPriceX96: ethers.BigNumber;
    tick: number;
    observationIndex: number;
    observationCardinality: number;
    observationCardinalityNext: number;
    feeProtocol: number;
    unlocked: boolean;
}

interface PositionState {
    nonce: number;
    operator: string;
    token0: string;
    token1: string;
    fee: number;
    tickLower: number;
    tickUpper: number;
    liquidity: ethers.BigNumber;
    feeGrowthInside0LastX128: ethers.BigNumber;
    feeGrowthInside1LastX128: ethers.BigNumber;
    tokensOwed0: ethers.BigNumber;
    tokensOwed1: ethers.BigNumber;
}

export interface Fees {
    fee0: number;
    fee1: number;
}

export async function getPoolImmutables(poolContract: ethers.Contract): Promise<Immutables> {
    return {
        factory: await poolContract.factory(),
        token0: await poolContract.token0(),
        token1: await poolContract.token1(),
        fee: await poolContract.fee(),
        tickSpacing: await poolContract.tickSpacing(),
        maxLiquidityPerTick: await poolContract.maxLiquidityPerTick(),
    };
}

export async function getPoolState(poolContract: ethers.Contract): Promise<State> {
    const slot = await poolContract.slot0();
    return {
        liquidity: await poolContract.liquidity(),
        sqrtPriceX96: slot[0],
        tick: slot[1],
        observationIndex: slot[2],
        observationCardinality: slot[3],
        observationCardinalityNext: slot[4],
        feeProtocol: slot[5],
        unlocked: slot[6],
    };
}

export function getTokenByAddress(address): Token {
    switch (address) {
        case '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48':
            return new Token(1, address, 6, "USDC", "USD Coin");
        case '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2':
            return new Token(1, address, 8, "WETH", "Wrapped Ether");
        case '0xdAC17F958D2ee523a2206206994597C13D831ec7':
            return new Token(1, address, 6, "USDT", "Tether USD");
        case '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599':
            return new Token(1, address, 8, "WBTC", "Wrapped BTC");
        default:
            throw Error("Unknown address " + address);
    }
}

export async function getPool(address): Promise<Pool> {
    const poolContract = new ethers.Contract(
        address,
        IUniswapV3PoolABI,
        provider
    );
    const immutables = await getPoolImmutables(poolContract);
    const state = await getPoolState(poolContract);
    const TokenA = getTokenByAddress(immutables.token0);
    const TokenB = getTokenByAddress(immutables.token1);
    return new Pool(
        TokenA,
        TokenB,
        immutables.fee,
        state.sqrtPriceX96.toString(),
        state.liquidity.toString(),
        state.tick
    );
}

export async function getPositionState(contract: ethers.Contract, tokenId): Promise<PositionState> {
    const pos = await contract.positions(tokenId);
    return {
        nonce: pos[0],
        operator: pos[1],
        token0: pos[2],
        token1: pos[3],
        fee: pos[4],
        tickLower: pos[5],
        tickUpper: pos[6],
        liquidity: pos[7],
        feeGrowthInside0LastX128: pos[8],
        feeGrowthInside1LastX128: pos[9],
        tokensOwed0: pos[10],
        tokensOwed1: pos[11],
    };
}

export async function collectFees(contract: ethers.Contract, owner, tokenId): Promise<Fees> {
    const result = await contract.callStatic
        .collect(
            {
                tokenId,
                recipient: owner, // some tokens might fail if transferred to address(0)
                amount0Max: BigNumber.from(2).pow(128).sub(1),
                amount1Max: BigNumber.from(2).pow(128).sub(1),
            },
            { from: owner } // need to simulate the call as the owner
        )
    return {fee0: parseFloat(result.amount0.toString()), fee1: parseFloat(result.amount1.toString())};
}

export async function getAllPositions(address: string, tokenResolver: ITokenReferenceResolver): Promise<PositionStats[]> {
    const numberOfNfts = await nftPositionContract.balanceOf(address);
    const pos = [];
    for (let i = 0; i < numberOfNfts; i++) {
        const tokenId = await nftPositionContract.tokenOfOwnerByIndex(address, i);
        const posState = await getPositionState(nftPositionContract, tokenId);
        const poolId = await factoryContract.getPool(posState.token0, posState.token1, posState.fee);
        const position = new Position({
            pool: await getPool(poolId),
            liquidity: posState.liquidity.toString(),
            tickLower: posState.tickLower,
            tickUpper: posState.tickUpper
        });
        const fees = await collectFees(nftPositionContract, address, tokenId);
        pos.push(await new PositionStats(address, tokenId.toString(), position, tokenResolver, fees));
    }
    return pos;
}

