import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    Sender,
    Slice,
    TupleItemSlice,
    SendMode,
    toNano,
} from '@ton/core';
import { TonPoolOpcodes } from './NominatorProxy';

export const TonPoolCodeBase64 =
    'te6ccgECogEAEhEAART/APSkE/S88sgLAQIBIAIDAgFIBAUADPIwgEjy8AICyQYHAgEgHh8CASAICQIBzgwNAgEgNDUCASAKCwIBIGFiAgEggIECASAODwIBIBYXAgEgEBECASASEwBpIIRKgXyABK+8uGR+ELy0ZL0BNF/jhohgwf0fG+lMiGdIPAb+FvCAJTwJvAc3t4Bs+Zb8BeAAaSCESoF8gASvvLhkfhC8tGS9ATRf44aIYMH9HxvpTIhnSDwG/hZwgCU8CnwHN7eAbPmW/AXgAJ8ghEqBfIAEr7y4ln4QvLSWvQE0X+ONSGDB/R8b6UyIY4ncFIQuvLSWyDwG/AoIcIA8uJc8uJdIfACcIIQetC5QvhBEDTwBPAc3gGz5lvwF4AL1AJxsJFb4IIQBfXhAFIQvvLhLQHTH9M/+gAB+AEB+GH4QcIA8uEughCiBl8sUiC6kzHwOeCCEGVNUY5SILqTW/A94IIQFZaSDFIgupNb8DzgghAlHWqYUiC6ljH4RHDwOOCCEJmoEftSILqTMfBA4IIQoZ/ZNFIguuMCgFBUABjHwQQAgghBTPs9cErqS8ELgW/LBTgIBIBgZAgEgGhsA1QCcbCOIwGAINch0x+CEE5zdEsSvZtbcPh0cPh18BnwF+DTPwH4YfA74AHTH9M/AfhhghDzdEhMUiC6kzHwOuCCEO5vRUxSILqTMfA74IIQ+W9zJBK6kvA/4Fv4VMMAmnD4dHD4dfAZ8BfegAFEMdMH+kDRIcAAkzH4Y44WIcABkzH4ZJ0BwAKS+GWVMIBI8vDi4uLwF4AL1AJxsJFb4IBIghAF9eEAUiC+8vQB0x8hwAAiwACWMnD4YfAPjhQB0z8B+GGASPhBwgDy9PoAAfgBWOKCENv6+BdSELqUMDHwNuCCCjzVLFIQupQwMfA34IIQe80f71IQupZfA3AB8DPgghDagD79UhC64wIyghBlTVGOgHB0A7QCcbCSXwPggEiCEAX14QBSIL7y9AHTHyHAACLAAJYycPhh8A+OFAHTPwH4YYBI+EHCAPL0+gAB+AFY4oIQe80f71IQupRfA/Az4IIQ2oA+/VIQup4wcAKzlDH6ADCRMOLwNOA0W4IQR7vkJRK6kvA14DCASPLwgACAwcAKzlDH6ANGRMOJwWfA0AHRSILqVW/AY8D7gghBHu+QlUiC6k1vwNeCCEJDq+uFSILqTMfBF4IIQJR1qmBK6lfhDf/A44FuASPLwAgEgICECAVgqKwIBICIjAgEgJicCAWokJQANtzS+At8IcAAkq57wFvAB8BvwI/hY+Fv4WfhcAAyrN/AW+EUCAecoKQAft84eAt8E7eRGHgXULhbBMAALpZ/gLfCbABGnD+At8JHwk0MCASAsLQIBIDIzAgEgLi8CASAwMQARrOd4C3wnN5PAAA2vAPgLfCJAACOuqXgLOHgN/CR8JPwmfCX8JUAAJa/W+At4APgN+BH8LHwt/Cz8LkAAY7EGPAW8Bj4VMMAcHD4T8MA+FDDALCeW/hP+FD4UvAVIPgjuwHe+E/4UfhC+FNeIxAkgAJewqbwFnDwG/AjbfhD+Fj4W/hZ+FxvBQFvAn+OLfhNgwf0fG+lMiGOHnBSEL2OFyDwG/AjIPAC+Fj4W/hZ+FxvBVADbwIC3t4Bs+YwgAgEgNjcCASBISQIBIDg5AgEgREUCASA6OwIBIEBBAgEgPD0CASA+PwBzAHQ0wP6QDDwFvhEUhDHBZYw8BhZ8EPg+EVSEMcFmDD4D/AYWfBE4PhDUhDHBZQwWfBG4PABQTPwR4AAVPpEgEYCwAAS8vSAAHRwIHLIywHLAMsHy//J0IABBALIyx/LPwHPF8lxgBjIywVQBc8WUAP6AhPLaszJAfsAgAgEgQkMAO1cCBxjhQDeqkMpjAkqBKgA6oHAqQhwABEMOYwbBKAA7AHIyx/LP8lxgBDIywVQBc8WUAP6AhPLaszJAfsAgAD0cMjLHwHPF8lxgBDIywVQBc8WUAP6AhPLaszJAfsAgAEHUEIHc1lAFSGAPgDgNUBIJhngMAXAOWDgPgDgNUBCWeAwC7fOADpg5DgIkcOGUAnAWmXgMEQMrg3ubS6XQn5ehDowQg95o/3gW8Q4CvHDplAJwFpm4DBFDS6NDI5MLvdCfl6EOjBCG1AH36BbxDgKUcOGUAnAWmXgMEQMrG3uzK5XQn5ehDowQgypqjHAW8Q4CrxgADgIPGAAMRkcAODKATgLTLwGCIG5vd25lZLoT8vQh0YIQJR1qmAIAODGATgHTLwGCIGlyZHJvcLoS8vQg0YIQR7vkJQECASBKSwIBIFlaAgEgTE0CASBSUwIBIE5PAgEgUFEAHSAD/gz0NMfgEDXIdMfMIAAbIAg+DPQeNch0x/THzCAAGyAIvgz0HjXIdMf0x8wgAD08BIxUhC5kjBw4CD4I7uSMHDg+COhggP0gLyRcOB/gAgEgVFUCASBWVwAtCDAAJIwMeDwEVBEu5USoAG2CeBfA3+AAjxTEqHwEVNRu44WNDQhwgCYMGwSoIEBLKDgbCGggQEsoOBb8BJRUbuOFTMhwgCXMDGggQEsoOAxbBKggQEsoOAQNF8EgQEsoIAHvO1E0NIAAfhi+kAB+GP6QAH4ZPpAAfhl1PQEAfht1AH4Zm0h10rCAJMw1AHeAdEB0NJ/Afhn+gAB+Gj6AAH4afoAAfhq+gAB+Gv6AAH4bNF/f4IQO5rKAIIQBfXhAIIQBfXhAIED6IIQBfXhAG8H+G4gbrORMOMNgWACrPhObycGyMoAFcoAUAP6AgH6AgH6AgH6AgH6Asn4RvhN+EfIyn/4SPoC+En6AvhK+gL4S/oC+Ez6Asn4QsjKAPhDzxb4RM8W+EXPFsz0AMzMye1U+A+AALNDSANIA+gD6APoA+gD6AFVgbwf4btECASBbXACT18LGEAfC3hAFj8LmEAWJBZ/C9YThh8K/wmwYP6LZh8NscTRxH8LXwu5GU//Cx9AXws/QFlAHwt/QF8Ln0BfCv8JsGD+iH8Nu9xQCASBdXgIBIF9gAIM+EbQ0x8B+G/THwH4cPoAAfhx0z8B+HTTHwH4dfoAAfh2cPhycPhzINdJwh+OEdMfAfhyINdJwgCV0gAB+HPe3tGAAST4U/hS+FX4VPhQ+E/Iyx/LH/hR+gLLP8sf+Fb6AssfygDJ+GaAAQzSfwH4ffoAAfh4+gAB+HnSAAH4evoAAfh7+gAB+Hx/+H6AAXT4TVIQgwf0Dm+hAvh3AZbwGtF/+H6OFjBw+Hhw+Hlw+Hpw+Htw+H1w+Hxw+H7igAgEgY2QCASBwcQIBIGVmAgEgaWoAUVgiAJGE5yoAASoIIgCRhOcqAAEqCogiAJGE5yoACpBIIgCRhOcqAAoYAgEgZ2gAMSCIAkYTnKgAAGgWKiCIAkYTnKgAFigqQSAAuz4V3C9jh34R/hdvY4V+Fj4XfhH8CL4WKH4WAGg+Hj4R/h93t74Wo4Z+Fn4WL2OEfhY+Fmh+EshoPhr+FkBoPh53o4Z+Fn4WLyOEfhY+Fmh+EshoPhr+FkBoPh53uKACASBrbAIBIG1uACccPhZofhLIaD4a/hZAaD4eXD4eoAAvIBNIcIA8vTwI/Ak+FshoPh7+EwBoPhsgAF0gEj4W8IA8vSASPhC8vLwI/hbcPhbofhbIaD4e/hMAaD4bPhYIaD4ePhIAaD4aIAHzIBNIcL/8vTwI/AkgE34WPhcoPhboCK+8vRwIcAA+FhSML6xm1t/+Fv4WKD4XKAB3nAiwgD4W8L/sI4YMPhbIrYIIKP4WyGg+Hv4TAGg+GxRIqEC3iLCAPhcwgCwjhf4XCO2CPhcIaH4fPhKIaH4amagUDOhAt4iwgCBvADCOECL4SyGg+Gv4WQGg+HkB+HqRMeIBwAACASBycwIBIHp7AgEgdHUCASB3eAHzPAj8CT4W/hYoPhcoHAhwgD4W8L/sI4XMPhbIbYIIKP4WyGg+Hv4TAGg+GxmoQHeIcIA+FzCALCOFvhcIrYI+Fwhofh8+EohofhqZqBZoQHeIcIA+EKzsPhYwgCwjhb4WCK2CPhYIaH4ePhIIaH4aGagWaEB3vhbwACB2AG0gEj4WcIA8vSASPhC8vLwI/hZ+Fghofh4+FwhoPh8+Eghofho+EohoPhq+EsBofhrcPh5cPh6gAETy4r34XMAA8uK++FjAAPLiv/hZwADy4sD4WsAA8uLBAcAAAaM+E5vJxZfBnDwGyHBAI47MPhY+EgBoYIgCRhOcqAAUiCo+EipBGaogiAJGE5yoACpBFIgofhIUAOg+Gj4WFig+Hj4RwHwIfhn8BzgIcIA4wJbgeQAhPhCs5uASPhLwADy9H/4Yt6AAjPhY+EgBoYIgCRhOcqAAUjCogScQUAOhEqj4SKdkp2SpBGaogiAJGE5yoACpBFIgofhIUAOg+Gj4WFig+Hj4RwHwIfhn8BwCASB8fQIBIH5/AA8+EKTcPhi3oAALPhI+EmhgACU+Ej4SaH4TKD4SqCCEDuaygCggAA0+EkBoPhpgAgEggoMCASCTlAIBIISFAgEgiosCASCGhwIBIIiJAA0+EkBofhpgABE+Emh8Cpw+GmAAQSASPhTs/hPwwCw8vT4T/hQ+FLwFIBIIcIA8vR/+HP4cIADhPhObyc1W4BIUATy9FIToBOhgE1SE74S8vQi8Bsg8CX4Q3BSQL2VMALwAgKRM+L4QcAAjipwyFgBghhTdGFrZQHLJ4AgAcsHAfAIgCAByweCMGFjY2VwdGVkAcs/8AWcMHCCEMZB6TL4QfAE4vAc8BeACASCMjQIBIJCRAck+E5vJzFsQlICoIBMUES+E/L0IvAb8Cf4WPhboPhZoSDCAJqCEDuaygC+8uH1kTDi+ENwUlC9lTAD8AIDkTTi+EHAAI4ZAqBwApaCECPUIeGWghB0uzQn4vhBECPwBOMN8BzwF4I4ANSASIIQO5rKAKoAUiC+8vSCEDuaygCh8CrwF4AHYAqBwAo5hyIKgeW91ciBiYWxhbmNlIGlzIHJlYWR5LoLgUGxlYXNlLCByZXRyeSB0aGUgY29tbWFuZCB3aGVugohXaXRoZHJhdyByZXF1ZXN0ZWQuUAPLl4AgAcsHEsvvgCABywfLr+MNEvAFjwAwyIKAV2l0aGRyYXcgY29tcGxldGVkAcuPAFs+E5vJxBWXwaASAHy9IBMghEqBfIAE74S8vTU0fsE+ENwgECCEFMuQHf4QfAEgAfU+E5vJxBWXwaATIIRKgXyABS+E/L01DDQ0gDSAPoA+gD6APoA+gDRgEgIsyawGPLygEiCEDuaygBSUL7y9IBIghAF9eEAUkC+8vSASIIQBfXhAFIwvvL0gEghgScQu/L0gEiCEAX14QBSgL7y9FUFbwf4bvAX+ENwgECCSABSCEDIRVGr4QfAEAgEglZYCASCcnQIBIJeYAgEgmpsAZxsIvgnbyIw8C6hcLYJAbOdgEiCGBdIdugAErny9JEw4vAucPsCcIEAgIIQHRcVv/hB8ASAB9z6ANP/0x/TH9P/1NGCEHc1lAAXvvLgavhUwwCT8sBl3vhPwwD4TyS9sJPywGbeIvAT8uBn8C0lvvLgaPAQ8Csk+G9SQqAhoPhw+FEmoPhx+HJw+HP4Qfh0ghBOc3RL+HUk+HYk8C/4RYIQO5rKABagcYIQTnN0S/hBB8iCZACzL/xbLHxTLHxLL/xbMEEUT8APwGfAXAD0W/hB+FS93PhVghBOc3RLvdxw+HRw+HVw+HbwGfAXgAIMW/hB+FS93PhVghBOc3RLvdz4VvAw+FH4VqH4cfhRwACOEXD4b3D4cHD4cXD4cnD4c/As3nD4dHD4dXD4dvAZ8BeACASCenwIBIKChACU8DKATIIQdzWUABK+8vTwGfAXgAJM+FTDAJPywGXe+EH4dPhPwwCOGPhTs5LwMt74U/LgyfhQgQEsoPgju/Lgyt6CEHc1lAC+8uDL+EVwgECCEEdldCT4QfAE8BnwF4AB9HD4dHD4dXD4dvhPwwCOK/hTs44V8DLwGfAX+FCBASyg+CO7kvA9kTDin4BI+FCBASyg+CO78vTwPeKS8D3igAJsMPhUwwCZcPh0cPh1cPh23vhQwwD4I/hQvLCOGnD4cXD4b3D4cHD4cnD4c4IQdzWUAKHwMfAsjhCCEHc1lAChIMIAkvAqkTDi4vAZ8BeA=';

export type TonPoolConfig = {
    owner: Address;
    controller: Address;
};

export function tonPoolConfigToCell(config: TonPoolConfig): Cell {
    let cellBalances = beginCell()
        .storeInt(0, 128) // profitPerCoin
        .storeCoins(0) // balance
        .storeCoins(0) // balanceSent
        .storeCoins(0) // balanceWithdrawn
        .storeCoins(0) // balancePendingWithdraw
        .storeCoins(0) // balancePendingDeposits
        .endCell();

    let nominators = Dictionary.empty(Dictionary.Keys.BigInt(256));

    let cellProxyState = beginCell()
        .storeUint(0, 32) // StakeAt
        .storeUint(0, 32) // StakeUntil
        .storeCoins(0) // StakeSent
        .storeUint(0, 64) // StoredQueryId
        .storeUint(0, 32) // StoredQueryOp
        .storeCoins(0) // StoredQueryStake
        .storeUint(0, 32) // StakeHeld
        .storeBit(0) // LockFinal
        .endCell();

    let cellPoolExtras = beginCell()
        .storeBit(true) // Enabled
        .storeBit(true) // UpdatesEnable
        .storeCoins(1_000_000_000) // MinStake, 1 TON
        .storeCoins(100_000_000) // DepositFee, 0.1 TON
        .storeCoins(100_000_000) // WithdrawFee, 0.1 TON
        .storeCoins(2000) // PoolFee, 20% given in basis points
        .storeCoins(100_000_000) // ReceiptPrice, 0.1 TON
        .endCell();

    // Just some some arbitrary address, it is not used for anything
    // in the tests we need to run.
    let proxyAddress = Address.parse('UQAHBakDk_E7qLlNQZxJDsqj_ruyAFpqarw85tO-c03fK4jK');

    return beginCell()
        .storeBit(false) // locked
        .storeAddress(config.owner) // owner
        .storeAddress(config.controller) // controller
        .storeAddress(proxyAddress) // proxy
        .storeRef(cellBalances)
        .storeDict(nominators)
        .storeRef(cellProxyState)
        .storeRef(cellPoolExtras)
        .endCell();
}

export class TonPool implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new TonPool(address);
    }

    static createFromConfig(config: TonPoolConfig, code: Cell, workchain = 0) {
        const data = tonPoolConfigToCell(config);
        const init = { code, data };
        return new TonPool(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendAcceptDeposit(provider: ContractProvider, via: Sender, address: Address) {
        let nominators = Dictionary.empty(Dictionary.Keys.BigUint(256), {
            serialize: (src: Slice, builder) => {
                builder.storeSlice(src);
            },
            parse: (src) => {
                return src;
            },
        });

        const rawAddress = address.hash; // gets the raw address bytes without workchain
        const addressKey = BigInt('0x' + rawAddress.toString('hex'));
        nominators.set(addressKey, beginCell().asSlice());

        await provider.internal(via, {
            value: toNano('5.0'),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(TonPoolOpcodes.acceptDeposit, 32) // operation
                .storeUint(123456789, 64) // query id
                .storeCoins(1_000_000_000) // gas limit, 1 TON
                .storeDict(nominators)
                .endCell(),
        });
    }

    async getMember(provider: ContractProvider, address: Address) {
        let addressTuple: TupleItemSlice = {
            cell: beginCell().storeAddress(address).endCell(),
            type: 'slice',
        };
        let member = await provider.get('get_member', [addressTuple]);

        let balance = member.stack.readBigNumber();
        let pendingDeposit = member.stack.readBigNumber();
        let pendingWithdraw = member.stack.readBigNumber();
        let withdraw = member.stack.readBigNumber();

        return {
            balance: balance,
            pendingDeposit: pendingDeposit,
            pendingWithdraw: pendingWithdraw,
            withdraw: withdraw,
        };
    }
}
