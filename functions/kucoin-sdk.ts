import {
    ClientOptionBuilder,
    DefaultClient,
    GlobalApiEndpoint,
    GlobalBrokerApiEndpoint,
    GlobalFuturesApiEndpoint,
    Spot,
    TransportOptionBuilder
} from 'kucoin-universal-sdk';

function example() {
    // Retrieve API secret information from environment variables
    const key = process.env.API_KEY || '';
    const secret = process.env.API_SECRET || '';
    const passphrase = process.env.API_PASSPHRASE || '';

    // Set specific options, others will fall back to default values
    const httpTransportOption = new TransportOptionBuilder()
        .setKeepAlive(true)
        .setMaxConnsPerHost(10)
        .setMaxIdleConns(10)
        .build();

    // Create a client using the specified options
    const clientOption = new ClientOptionBuilder()
        .setKey(key)
        .setSecret(secret)
        .setPassphrase(passphrase)
        .setSpotEndpoint(GlobalApiEndpoint)
        .setFuturesEndpoint(GlobalFuturesApiEndpoint)
        .setBrokerEndpoint(GlobalBrokerApiEndpoint)
        .setTransportOption(httpTransportOption)
        .build();

    const client = new DefaultClient(clientOption);

    // Get the Restful Service
    const kucoinRestService = client.restService();

    const spotMarketApi = kucoinRestService.getSpotService().getMarketApi();

    // Create request by interface
    let request = Spot.Market.GetPartOrderBookReq.create({
        'symbol': 'BTC-USDT',
        'size': '20',
    })

    // Or create request by builder
    request = Spot.Market.GetPartOrderBookReq.builder().setSize('20').setSymbol('BTC-USDT').build();

    // Query for part orderbook depth data. (aggregated by price)
    spotMarketApi.getPartOrderBook(request).then((result) => {
        console.log(`Time: ${result.time}, Seq: ${result.sequence}, Bids: ${result.bids}, Asks: ${result.asks}`);
    }).catch((err) => {
        console.error('fail to get part order book', err);
    })
}


example()