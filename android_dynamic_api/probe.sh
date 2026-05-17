#!/bin/bash
sudo modprobe binder_linux
sudo mkdir -p /dev/binderfs
if ! mount | grep -q "/dev/binderfs"; then
    sudo mount -t binder binder /dev/binderfs
fi
for dev in binder hwbinder vndbinder; do
    if [ ! -L /dev/$dev ]; then
        sudo ln -s /dev/binderfs/$dev /dev/$dev
    fi
done