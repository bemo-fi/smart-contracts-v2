# smart-contract
![272541268-aee9057d-0df6-4020-9b18-18bb27dc6464.png](272541268-aee9057d-0df6-4020-9b18-18bb27dc6464.png)

# Deposit and withdrawal. 
![272541216-7c24175b-fedf-4fe3-8da7-ef7150ddc669.png](272541216-7c24175b-fedf-4fe3-8da7-ef7150ddc669.png)
    A user sends Ton to our protocol. It calculates the current rate, and uses it to send stTon to the user's wallet. It is important to note, this is the only possible way to issue stTon. 
To withdraw the tokens must be burned, then the financial s-c will create a request for withdrawal, and will record what amount should be blocked on it for further withdrawal. The requester has a lock of 36-72 hours, depends on the epoch. All this can be done decentralized without us, we can provide instructions.

# Sending funds for validation.
![272541236-fea02d92-e956-48de-8c63-361242380e53.png](272541236-fea02d92-e956-48de-8c63-361242380e53.png)
    Our oracle checks the current state of the rounds, and an hour before the validation starts, creates a request to transfer funds from financial s-c to nominaror-pool. For this purpose, we have developed our own transaction multisig s-c, the peculiarity of which is that funds can only be sent to a certain type of contract, namely nominator-pool. Multisig will not be able to request sending assets to any other type of smart contract, including wallet. In case even all keys are lost, an attacker will not gain access to your assets. 
After the request is sent to the financial s-c. That in turn sends the assets to the nominator-proxy. Nominator-proxy participates in the pool as a nominator.

# Validation withdrawals.
![272541252-966089aa-793c-4d17-b0e6-7691f72c61b7.png](272541252-966089aa-793c-4d17-b0e6-7691f72c61b7.png)
    You can send a withdrawal request 10 hours after the nominator-proxy has sent the money for validation. This is enough time for the round to start and finish. Anyone can request a withdrawal. This is done for decentralization, so the assets cannot be locked to the nominator. When the round is over and the assets return to the pool, Mytonctrl software will make a withdrawal to the nominator-proxy. It will in turn send the assets to the financial s-c along with the validation reward data. The financial s-c will change the internal Ton pools, and then the rate will increase.

You can read the technical documentation for smart contracts [here](https://github.com/bemo-fi/smart-contracts-v2-docs) and stake TON [here](https://app.bemo.fi/).
