import {Address, toNano} from 'ton-core'
import {NetworkProvider} from '@ton-community/blueprint'
import {NominatorPool} from "../wrappers/NominatorPool";

export async function run(provider: NetworkProvider) {
    const pool = provider.open(NominatorPool.createFromAddress(Address.parse("EQD445KwPfE_km38vgzATI6jX8t1ai9tl56GHar5p12ckfb-")));
    await pool.sendValidatorDeposit(provider.sender(), toNano("10"))
}

