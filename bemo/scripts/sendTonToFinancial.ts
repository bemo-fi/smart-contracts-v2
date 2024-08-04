import {Address, toNano} from '@ton/core'
import {Financial} from '../wrappers/Financial'
import {NetworkProvider} from '@ton/blueprint'

export async function run(provider: NetworkProvider) {
    const financial = provider.open(Financial.createFromAddress(Address.parse("EQBc9tVIjRuVl25z_hVuYEzacJolOzR594YMEaTrFS7YPgu7")));
    await financial.sendTonToFinancial(provider.sender(), toNano('1.5'));
}
