import {Token} from "@uniswap/sdk-core";
import {Position} from "@uniswap/v3-sdk";
import CoinMarketCap = require("coinmarketcap-api/index");
import {Fees} from "./core";
import {BigNumber} from "ethers";

const quoteCache: {[key: string]: [number, number]} = {};

export interface ITokenReferenceResolver {
    referencedToken: string;
    getQuote: (token: Token) => Promise<number>;
}

export class TokenReferenceResolver {
    public referencedToken: string;
    private readonly _cmc: CoinMarketCap;

    constructor(cmc: CoinMarketCap, referencedToken: string) {
        this._cmc = cmc;
        this.referencedToken = referencedToken;
    }

    public async getQuote(token: Token): Promise<number> {
        if (!quoteCache[token.symbol] || (Date.now() - quoteCache[token.symbol][0]) > 7200) {
            const cmcToken = await this._cmc.getQuotes({symbol: token.symbol, convert: this.referencedToken});
            quoteCache[token.symbol] = [Date.now(), cmcToken.data[token.symbol].quote[this.referencedToken].price];
        }
        return quoteCache[token.symbol][1];
    }
}

export class Amount {
    public token: Token;
    public amount: number;
    private tokenResolver: ITokenReferenceResolver;

    constructor(token: Token, amount: BigNumber | number, tokenResolver: ITokenReferenceResolver) {
        this.token = token;
        if (amount instanceof BigNumber) {
            this.amount = parseFloat(amount.toString());
        } else {
            this.amount = amount;
        }
        this.tokenResolver = tokenResolver;

    }

    public async toReferencedQuote(): Promise<number> {
        return await this.tokenResolver.getQuote(this.token) * this.amount;
    }

    public async toString(): Promise<string> {
        return `${this.amount} ${this.token.symbol} (${await this.toReferencedQuote()} ${this.tokenResolver.referencedToken})`
    }
}

export interface IPositionStats {
    owner: string;
    id: string,
    position: Position,
    token0: {
        rangeMin: Amount,
        rangeMax: Amount
        liquidity: Amount,
        fee: Amount
    },
    token1: {
        liquidity: Amount,
        fee: Amount
    }
}

function unrawCurrency(amount, decimals): number {
    return amount / Math.pow(10, decimals);
}

export class PositionStats implements IPositionStats {
    public owner: string;
    public id: string;
    public position: Position;
    public token0: { rangeMin: Amount; rangeMax: Amount; liquidity: Amount; fee: Amount };
    public token1: { liquidity: Amount; fee: Amount };
    private readonly _tokenResolver: ITokenReferenceResolver;

    constructor(address: string, positionId: string, position: Position, tokenResolver: ITokenReferenceResolver, fees: Fees) {
        this.owner = address;
        this.id = positionId;
        this.position = position;
        this._tokenResolver = tokenResolver;

        this.token0 = {
            rangeMin: null,
            rangeMax: null,
            liquidity: new Amount(this.position.pool.token0, parseFloat(position.amount0.toFixed()) / this._divisidor(position.pool.token0.symbol), this._tokenResolver),
            fee: new Amount(
                this.position.pool.token0,
                unrawCurrency(fees.fee0, position.pool.token0.decimals) / this._divisidor(position.pool.token0.symbol),
                this._tokenResolver
            )
        }
        this.token1 = {
            liquidity: new Amount(this.position.pool.token1, parseFloat(position.amount1.toFixed()) / this._divisidor(position.pool.token1.symbol), this._tokenResolver),
            fee: new Amount(
                this.position.pool.token1,
                unrawCurrency(fees.fee1, position.pool.token1.decimals) / this._divisidor(position.pool.token1.symbol),
                this._tokenResolver
            )
        }
    }

    public async totalLiquidity(): Promise<number> {
        return await this.token0.liquidity.toReferencedQuote() + await this.token1.liquidity.toReferencedQuote();
    }

    public async totalFees(): Promise<number> {
        return await this.token0.fee.toReferencedQuote() + await this.token1.fee.toReferencedQuote();
    }

    public inRange(): boolean {
        return this.position.pool.tickCurrent >= this.position.tickLower && this.position.pool.tickCurrent < this.position.tickUpper;
    }

    private _divisidor(symbol: string) {
        if (symbol == 'WETH') {
            return 10000000000;
        }
        return 1;
    }
}
