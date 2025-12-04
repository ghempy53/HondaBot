## **Features**

* Receive notifications for [In-Game Events](docs/discord_text_channels.md#events-channel) (Patrol Helicopter, Cargo Ship, Chinook 47, Oil Rigs triggered).
* Control [Smart Switches](docs/smart_devices.md#smart-switches) or Groups of Smart Switches via Discord or In-Game Team Chat.
* Setup [Smart Alarms](docs/smart_devices.md#smart-alarms) to notify in Discord or In-Game Team Chat whenever they are triggered.
* Use [Storage Monitors](docs/smart_devices.md#storage-monitors) to keep track of Tool Cupboard Upkeep or Large Wooden Box/Vending Machine content.
* Head over to the [Information Text Channel](docs/images/information_channel.png) to see all sorts of information about the server, ongoing events and team member status.
* Communicate with teammates from [Discord to In-Game](docs/discord_text_channels.md#teamchat-channel) and vice versa.
* Keep track of other teams on the server with the [Battlemetrics Player Tracker](docs/discord_text_channels.md#trackers-channel).
* Alot of [QoL Commands](docs/commands.md) that can be used In-Game or from Discord.
* View the [Full list of features](docs/full_list_features.md).


## **Documentation**

> Documentation can be found [here](https://github.com/alexemanuelol/rustplusplus/blob/master/docs/documentation.md). The documentation explains the features as well as `how to setup the bot`, so make sure to take a look at it 😉

## **Credentials**

> You can get your credentials by running the `rustplusplus credential application`. Download it [here](https://github.com/alexemanuelol/rustplusplus-credential-application/releases/download/v1.4.0/rustplusplus-1.4.0-win-x64.exe)


## **How to run the bot**

> To run the bot, simply open the terminal of your choice and run the following from repository root:

    $ npm start run


## **How to update the repository**

> Depending on your OS / choice of terminal you can run:

    $ update.bat

or

    $ ./update.sh


## **Running via docker**

    $ docker run --rm -it -v ${pwd}/credentials:/app/credentials -v ${pwd}/instances:/app/instances -v ${pwd}/logs:/app/logs -e RPP_DISCORD_CLIENT_ID=111....1111 -e RPP_DISCORD_TOKEN=token --name rpp ghcr.io/alexemanuelol/rustplusplus

or

    $ docker-compose up -d

Make sure you use the correct values for DISCORD_CLIENT_ID as well as DISCORD_TOKEN in the docker command/docker-compose.yml

## Running on Raspberry Pi

    $ 1. Install Git
    $ 2. Clone HondaBot onto the Raspberry Pi using SSH
    $ 3. Install npm and NodeJS v22 or higher
    $ 4. sudo ./update.sh
    $ 5. Create .env file with secret Discord data
    $ 6. Install Docker
    $ 7. Disable IPv6 on your Raspberry Pi
    $     a. Create /etc/docker/daemon.json
    $ 8. DOCKER_BUILDKIT=0 docker compose build --no-cache
    $ 9. docker compose up -d

## Updating Docker IPv4 Hosts
```
sudo tee /usr/local/bin/update-docker-hosts << 'EOF'
#!/bin/bash
sudo sed -i '/registry-1.docker.io/d' /etc/hosts
sudo sed -i '/auth.docker.io/d' /etc/hosts
sudo sed -i '/production.cloudflare.docker.com/d' /etc/hosts

echo "$(getent ahosts registry-1.docker.io | grep -v ':' | head -1 | awk '{print $1}') registry-1.docker.io" | sudo tee -a /etc/hosts
echo "$(getent ahosts auth.docker.io | grep -v ':' | head -1 | awk '{print $1}') auth.docker.io" | sudo tee -a /etc/hosts
echo "$(getent ahosts production.cloudflare.docker.com | grep -v ':' | head -1 | awk '{print $1}') production.cloudflare.docker.com" | sudo tee -a /etc/hosts

echo "Docker hosts updated!"
EOF
sudo chmod +x /usr/local/bin/update-docker-hosts
```

