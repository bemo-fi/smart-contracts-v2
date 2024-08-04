import {Address} from '@ton/core'
import {NetworkProvider} from '@ton/blueprint'
import {TransactionMultisig} from "../wrappers/TransactionMultisig";

export async function run(provider: NetworkProvider) {
    const transactionMultisig = provider.open(
        TransactionMultisig.createFromAddress(Address.parse("EQC7vy1mW_wPJPbbEAfWcOd-DNV66YYJb8vYJPpoplZUmlTr"))
    );

    console.log(await transactionMultisig.getPoolAndProxyAddresses(
        "Ef-H2YtJe0FQuXXN8QsY_-fggtXo74WaERkJNQjXAhN9cHk3",
        10,
        40,
        1001,
        100000
    ))
}
