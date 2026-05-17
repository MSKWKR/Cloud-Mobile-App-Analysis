FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt update && apt install -y python3 python3-pip python2 && apt clean

WORKDIR /app
COPY . /app

RUN pip3 install -r requirements.txt

EXPOSE 8010

CMD bash -c "bash ./Frida/maldroid/install_requests.sh && python3 ./Frida/maldroid/androguard_server.py"