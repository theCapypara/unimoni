#!/usr/bin/env ts-node
import {getAllPositions} from "./core";
import CoinMarketCap = require("coinmarketcap-api/index");
import {TokenReferenceResolver} from "./stats";
import fs = require('fs');

const ADDRESS = process.env.ADDRESS;
const CMC_API = process.env.CMC_API_KEY;
const COMPARE_TOKEN = process.env.COMPARE_TOKEN;
const FILE = process.env.FILE;
const cmc = new CoinMarketCap(CMC_API);

const sleep = (milliseconds) => {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function round3Decimals(num) {
    return Math.round((num + Number.EPSILON) * 1000) / 1000;
}

function round2Decimals(num) {
    return Math.round((num + Number.EPSILON) * 100) / 100;
}

async function main() {
    while (true) {
        const out = fs.createWriteStream(FILE);
        let liquidSum = 0;
        let feeSum = 0;
        for (const pos of await getAllPositions(ADDRESS, new TokenReferenceResolver(cmc, COMPARE_TOKEN))) {
            const refLiquid0 = await pos.token0.liquidity.toReferencedQuote();
            const refLiquid1 = await pos.token1.liquidity.toReferencedQuote();
            const refFee0 = await pos.token0.fee.toReferencedQuote();
            const refFee1 = await pos.token1.fee.toReferencedQuote();
            liquidSum += refLiquid0 + refLiquid1;
            feeSum += refFee0 + refFee1;
            out.write(
                `${round3Decimals(pos.token0.liquidity.amount).toString().padEnd(7)} ${pos.position.pool.token0.symbol.padEnd(4)} ` +
                `([b]${round2Decimals(refLiquid0).toString().padEnd(7)}[/b] ${COMPARE_TOKEN})  ` +
                `${round3Decimals(pos.token0.fee.amount).toString().padEnd(7)} ` +
                `([b]${round2Decimals(refFee0).toString().padEnd(7)}[/b])\n`
            );
            out.write(
                `${round3Decimals(pos.token1.liquidity.amount).toString().padEnd(7)} ${pos.position.pool.token1.symbol.padEnd(4)} ` +
                `([b]${round2Decimals(refLiquid1).toString().padEnd(7)}[/b] ${COMPARE_TOKEN})  ` +
                `${round3Decimals(pos.token1.fee.amount).toString().padEnd(7)} ` +
                `([b]${round2Decimals(refFee1).toString().padEnd(7)}[/b])\n\n`
            );
        }
        out.write(
            `              ` +
            `[u][b]${round2Decimals(liquidSum).toString().padEnd(7)}[/b][/u] ${COMPARE_TOKEN}            ` +
            `[u][b]${round2Decimals(feeSum).toString().padEnd(7)}[/b][/u]\n\n`
        );
        out.write(
            `                       ` +
            `[s=1.4][u][b]${round2Decimals(liquidSum + feeSum).toString().padEnd(7)}[/b] ${COMPARE_TOKEN}[/u][/s]`
        );
        out.close();
        console.log("Refreshed");
        await sleep(120000);
    }
}

main();
