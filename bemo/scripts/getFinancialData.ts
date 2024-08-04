import {Address} from '@ton/core'
import {NetworkProvider} from '@ton/blueprint';
import {Financial} from "../wrappers/Financial";

export async function run(provider: NetworkProvider) {
    const fin = provider.open(Financial.createFromAddress(Address.parse("EQDNhy-nxYFgUqzfUzImBEP67JqsyMIcyk2S5_RwNNEYku0k")))
    console.log(await fin.getFinancialData())
}

