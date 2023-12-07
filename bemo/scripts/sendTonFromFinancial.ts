import {Address, toNano} from 'ton-core'
import {Financial} from '../wrappers/Financial'
import {NetworkProvider} from '@ton-community/blueprint'

export async function run(provider: NetworkProvider) {
    const financial = provider.open(Financial.createFromAddress(Address.parse("EQBc9tVIjRuVl25z_hVuYEzacJolOzR594YMEaTrFS7YPgu7")));


    await financial.sendTonFromFinancial(provider.sender(), toNano('0.05'), {
        destinationAddress: "EQCEuIGH8I2bkAf8rLpuxkWmDJ_xZedEHDvjs6aCAN2FrkFp",
        amount: 10.4
    });
}
