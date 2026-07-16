# apple-pi-container

A simple tool for using an Apple [container](https://github.com/apple/container) to sandbox shell-based tool calls.
Based off the [example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/gondolin) in Pi for using [gondolin](https://github.com/earendil-works/gondolin).

## Ethos
Configuration of `pi` should happen on the host system. File manipulation should happen in a container. It should be easy to use and fast.

## Usage
For right now, the best way to use this extension is to put it in a folder somewhere and then run:
`pi -e path/to/apple-pi-container --apple-container-image ubuntu:latest`

## TODOs
- [ ] Add better toggle UX via Pi slash command
- [ ] Make project configuration easier in `.pi` directory
- [ ] Support devcontainers
- [ ] Make using project local dependency caching easier for Linux guest
