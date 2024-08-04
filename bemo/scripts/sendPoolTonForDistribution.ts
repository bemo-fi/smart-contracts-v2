import {Address, toNano} from '@ton/core'
import {NetworkProvider} from '@ton/blueprint'
import {NominatorPool} from "../wrappers/NominatorPool";

export async function run(provider: NetworkProvider) {
    const pool = provider.open(NominatorPool.createFromAddress(Address.parse("Ef9Q3y_JQr7uIoB6uKKFXhcpCwnIq4nUP-eDdVuQYdYsUERp")));
    await pool.sendDistributeShare(provider.sender(), toNano("10"))
}
