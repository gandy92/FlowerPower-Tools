#!/bin/bash

echo "--------------------"
date
#sudo node app.js 2>&1
sudo node app.js
#
# disconnect any remaining connections to work around a bug consuming too much battery power sometimes:
# (possibly we need to find out how to not disconnect "foreign" connections)
#hcitool con |grep handle|sed -re s/.+handle.//|while read h rest; do sudo hcitool ledc $h; done
handles=$(hcitool con |grep handle|sed -re s/.+handle.//|cut -d\  -f1)
if [ -n "$handles" ]; then
	echo -n "Detected left-over "
	hcitool con
	echo "Disconnecting now..."
	for h in $handles; do
		sudo hcitool ledc $h
	done
	echo -n "Cross-checking "
	hcitool con
fi
exit 0
