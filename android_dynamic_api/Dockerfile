FROM ubuntu:20.04
MAINTAINER halloworld

RUN apt update -y 
RUN apt install apktool -y
RUN apt install adb -y
RUN apt install python3-magic -y
RUN apt install git -y
RUN apt install python3-pip -y
RUN apt install wget -y
RUN apt install openjdk-11-jdk-headless -y
# For weasyprint package: https://doc.courtbouillon.org/weasyprint/stable/first_steps.html
RUN apt install python3-cffi python3-brotli libpango-1.0-0 libharfbuzz0b libpangoft2-1.0-0 -y
RUN wget https://bootstrap.pypa.io/pip/2.7/get-pip.py
RUN apt install python2 -y
RUN python2 get-pip.py

# Install Requirements
COPY Frida/requirements.txt /tmpinstall/requirements.txt 
RUN pip3 install -r /tmpinstall/requirements.txt 
COPY Frida/maldroid/requirements.txt /tmpinstall/requirements.txt 
RUN pip2 install -r /tmpinstall/requirements.txt 

# AndroidSDK, APIMonitor
WORKDIR /
RUN mkdir AndroidDynamicSystem
ADD AndroidSDK /AndroidDynamicSystem/AndroidSDK
ADD APIMonitor-beta /AndroidDynamicSystem/APIMonitor-beta
ADD ./Autostart/docker_start.sh /AndroidDynamicSystem

# Frida, Inject project, TestLoader
ADD Frida /AndroidDynamicSystem/Frida
ADD InjectProject /AndroidDynamicSystem/InjectProject
ADD TestLoader /AndroidDynamicSystem/TestLoader
COPY local.properties /AndroidDynamicSystem/InjectProject/
COPY local.properties /AndroidDynamicSystem/TestLoader/

# For Zh-TW output: 
COPY ./songti.ttc /usr/share/fonts/
RUN fc-cache -vf

CMD bash -c "bash /AndroidDynamicSystem/docker_start.sh"
