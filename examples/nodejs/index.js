const { SerialPort } = require("serialport");
const { TX510 } = require("tx510js");

async function main() {


  const port = new SerialPort({
    path: "/dev/tty.usbserial-130",
    baudRate: 115200,
    dataBits: 8,

    stopBits: 1,
    parity: 'none',
    autoOpen: true,
  });

  const tx510 = new TX510(port);

  const version = await tx510.queryVersion();
  console.log('Version', version);
  // const version = await queryVersion();

  // console.log('Version', version);

  console.log(await tx510.identifyFace());

}




main().catch((e) => {
  console.error('Error', e);
});
