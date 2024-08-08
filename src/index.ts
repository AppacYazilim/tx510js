

import { Duplex, Transform } from 'stream';

class MyPacketParser extends Transform {

  incommingData: Buffer;


  constructor(private packageFunction: (data: Buffer) => boolean) {
    super();

    this.incommingData = Buffer.alloc(0);
  }

  _transform(chunk: Buffer, encoding: string, callback: Function) {
    this.incommingData = Buffer.concat([this.incommingData, chunk]);


    // console.log('Transforming package', this.incommingData);
    if (this.packageFunction(this.incommingData)) {
      this.push(this.incommingData);
      this.incommingData = Buffer.alloc(0);
    }


    callback();
  }
}

enum IdentificationIssues {
  Sucess = 0x00,
  NoFaceDetected = 0x01,
  FaceAngleTooLarge = 0x03,
  '2DInVivoDidNotPass' = 0x05,
  '3DInVivoDidNotPass' = 0x07,
  MatchNotPassed = 0x08,
  RepeatRegister = 0x09,
  FailedToSave = 0x0A,
}

enum EigenFaceWriteIssues {
  Success = 0x00,
  Failure = 0x01,
  FaceDuplication = 0x09,
}

interface Package {
  messageId: number;
  data: Buffer;
}


const START_BYTE = 0xEFAA;

const IdentifyFaceMessageId = 0x12 as const;
const RegisterUserMessageId = 0x13 as const;

const DeleteAllFacesMessageId = 0x21 as const;
const DeleteUserMessageId = 0x20 as const;

const QueryVersionMessageId = 0x30 as const;

const BacklightControlMessageId = 0xC0 as const;
const DisplayControlMessageId = 0xC1 as const;
const WhiteLightControlMessageId = 0xC2 as const;
const RebootMessageId = 0xC3 as const;
const ReadNumberOfFacesMessageId = 0xC4 as const;
const WriteEigenValueMessageId = 0xC5 as const;
const ReadEigenValueMessageId = 0xC6 as const;

export class TX510 {

  private parser: MyPacketParser;

  constructor(private stream: Duplex) {
    this.parser = this.stream.pipe(new MyPacketParser((data) => {
      try {
        this.decodePackage(data);
        return true;
      } catch (e) {
        return false;
      }
     }));
    };
  

  private encodePackage(packageContents: Package) {

    // console.log('Encoding package', packageContents);

    const data = Buffer.alloc(7 + packageContents.data.length + 1);

    data.writeUInt16BE(START_BYTE, 0);
    data.writeUInt8(packageContents.messageId, 2);
    data.writeUInt32BE(packageContents.data.length, 3);
    packageContents.data.copy(data, 7);

    // Calculate checksum
    //  The checksum of the protocol is calculated by adding the remaining bytes of the entire protocol after the Sync Word part is removed.

    let checksum = 0;
    for (let i = 2; i < data.length; i++) {
      checksum += data.readUInt8(i);
    }

    checksum = checksum & 0xFF;

    // console.log("Checksum", checksum, data.length);

    data.writeUInt8(checksum, 7 + packageContents.data.length);

    return data;
  }


  private decodePackage(data: Buffer) {

    // console.log("Decoding package", data);

    const header = data.readUInt16BE(0);

    if (header !== START_BYTE) {
      throw new Error('Invalid start byte');
    }

    const messageId = data.readUInt8(2); // 0x00 is the reply package

    const length = data.readUInt32BE(3); // 4 bytes of length
    // console.log("Length", length);

    if (length !== data.length - 8) {
      throw new Error(`Invalid length. Expected ${length}, got ${data.length - 8}`);
    }

    const parity = data.readUInt8(7 + length);

    let checksum = 0;

    for (let i = 2; i < 7 + length; i++) {
      checksum += data.readUInt8(i);
    }

    checksum = checksum & 0xFF;

    if (checksum !== parity) {
      throw new Error(`Invalid checksum. Expected ${checksum}, got ${parity}`);
    }


    const packageContents: Package = {
      messageId,
      data: data.slice(7, 7 + length),
    };

    return packageContents;
  }



  private sendMessageAndReturnOutput(message: Buffer) {
    return new Promise<Package>((resolve, reject) => {
      this.stream.write(message, (err) => {
        if (err) {
          reject(err);
        }
      });


      this.parser.once('data', (data: Buffer) => {
        try {
          const p = this.decodePackage(data);
          resolve(p);
        } catch (e) {
          reject(e);
        }
      });
    });
  }


  async deleteUser(userId: number) {

    const data = Buffer.alloc(2);

    data.writeUInt16BE(userId, 0);

    const message = this.encodePackage({
      messageId: DeleteUserMessageId,
      data,
    });

    const resp = await this.sendMessageAndReturnOutput(message);


    if (resp.messageId !== 0) {
      throw new Error('Invalid message id');
    }

    const replyMessageId = resp.data.readUInt8(0);

    if (replyMessageId !== DeleteUserMessageId) {
      throw new Error('Invalid reply message id');
    }

    const resultValue = resp.data.readUInt8(1);

    if (resultValue !== 0) {
      return false;
    }

    return true;
  }


  async deleteAllFaces() {
    const data = this.encodePackage({
      messageId: DeleteAllFacesMessageId,
      data: Buffer.alloc(0),
    });

    const result = await this.sendMessageAndReturnOutput(data);


    if (result.messageId !== 0) {
      throw new Error('Invalid message id');
    }

    const replyMessageId = result.data.readUInt8(0);

    if (replyMessageId !== DeleteAllFacesMessageId) {
      throw new Error('Invalid reply message id');
    }

    const resultValue = result.data.readUInt8(1);

    if (resultValue !== 0) {
      return false;
    }

    return true;
  }

/**
 * Identify face, returns the user id if the face is recognized, null otherwise
 * @returns number | null
 */
  async identifyFace() {
    const data = this.encodePackage({
      messageId: IdentifyFaceMessageId,
      data: Buffer.alloc(0),
    });

    const result = await this.sendMessageAndReturnOutput(data);

    if (result.messageId !== 0) {
      throw new Error('Invalid message id');
    }

    const replyMessageId = result.data.readUInt8(0);

    if (replyMessageId !== IdentifyFaceMessageId) {
      throw new Error('Invalid reply message id');
    }

    const resultCode = result.data.readUInt8(1);

    if (resultCode !== 0) {
      return null;
    }

    const userId = result.data.readUInt16BE(2);

    return userId;
  }

  async registerUser() {
    const data = this.encodePackage({
      messageId: RegisterUserMessageId,
      data: Buffer.alloc(0),
    });

    const result = await this.sendMessageAndReturnOutput(data);

    if (result.messageId !== 0) {
      throw new Error('Invalid message id');
    }

    const replyMessageId = result.data.readUInt8(0);

    if (replyMessageId !== RegisterUserMessageId) {
      throw new Error('Invalid reply message id');
    }

    const resultCode = result.data.readUInt8(1);

    console.log("data", result.data);
    if (resultCode !== 0) {

      if (resultCode === IdentificationIssues.NoFaceDetected) {
        throw new Error('No face detected');
      }

      if (resultCode === IdentificationIssues.FaceAngleTooLarge) {
        throw new Error('Face angle too large');
      }

      if (resultCode === IdentificationIssues.RepeatRegister) {
        throw new Error('User already registered');
      }

      if (resultCode === IdentificationIssues.FailedToSave) {
        throw new Error('Failed to save user');
      }

      throw new Error('Unknown error');
    }

    const userId = result.data.readUInt16BE(2);

    return userId;
  }


  async queryVersion() {
    const data = this.encodePackage({
      messageId: QueryVersionMessageId,
      data: Buffer.alloc(0),
    });

    const result = await this.sendMessageAndReturnOutput(data);

    if (result.messageId !== 0) {
      throw new Error('Invalid message id');
    }

    const replyMessageId = result.data.readUInt8(0);

    if (replyMessageId !== QueryVersionMessageId) {
      throw new Error('Invalid reply message id');
    }

    const chipId = result.data.toString('hex', 1, 9);

    const version = result.data.toString('utf8', 9);

    return { chipId, version };
  }

  async backlightControl(status: boolean) {
    const data = Buffer.alloc(1);

    data.writeUInt8(status ? 1 : 0, 0);

    const message = this.encodePackage({
      messageId: BacklightControlMessageId,
      data,
    });

    const result = await this.sendMessageAndReturnOutput(message);

    if (result.messageId !== 0) {
      throw new Error('Invalid message id');
    }

    const replyMessageId = result.data.readUInt8(0);

    if (replyMessageId !== BacklightControlMessageId) {
      throw new Error('Invalid reply message id');
    }

    const resultCode = result.data.readUInt8(1);

    if (resultCode !== 0) {
      return false;
    }

    return true;
  }

  async displayControl(status: boolean) {
    const data = Buffer.alloc(1);

    data.writeUInt8(status ? 1 : 0, 0);

    const message = this.encodePackage({
      messageId: DisplayControlMessageId,
      data,
    });

    const result = await this.sendMessageAndReturnOutput(message);

    if (result.messageId !== 0) {
      throw new Error('Invalid message id');
    }

    const replyMessageId = result.data.readUInt8(0);

    if (replyMessageId !== DisplayControlMessageId) {
      throw new Error('Invalid reply message id');
    }

    const resultCode = result.data.readUInt8(1);

    if (resultCode !== 0) {
      return false;
    }

    return true;
  }

  async whiteLightControl(status: boolean) {
    const data = Buffer.alloc(1);

    data.writeUInt8(status ? 1 : 0, 0);

    const message = this.encodePackage({
      messageId: WhiteLightControlMessageId,
      data,
    });

    const result = await this.sendMessageAndReturnOutput(message);

    if (result.messageId !== 0) {
      throw new Error('Invalid message id');
    }

    const replyMessageId = result.data.readUInt8(0);

    if (replyMessageId !== WhiteLightControlMessageId) {
      throw new Error('Invalid reply message id');
    }

    const resultCode = result.data.readUInt8(1);

    if (resultCode !== 0) {
      return false;
    }

    return true;
  }

  async reboot() {
    const data = Buffer.alloc(0);

    const message = this.encodePackage({
      messageId: RebootMessageId,
      data,
    });

    const result = await this.sendMessageAndReturnOutput(message);

    if (result.messageId !== 0) {
      throw new Error('Invalid message id');
    }

    const replyMessageId = result.data.readUInt8(0);

    if (replyMessageId !== RebootMessageId) {
      throw new Error('Invalid reply message id');
    }

    const resultCode = result.data.readUInt8(1);

    if (resultCode !== 0) {
      return false;
    }

    return true;
  }


  async readNumberOfFaces() {
    const data = Buffer.alloc(0);

    const message = this.encodePackage({
      messageId: ReadNumberOfFacesMessageId,
      data,
    });

    const result = await this.sendMessageAndReturnOutput(message);

    if (result.messageId !== 0) {
      throw new Error('Invalid message id');
    }

    const replyMessageId = result.data.readUInt8(0);

    if (replyMessageId !== ReadNumberOfFacesMessageId) {
      throw new Error('Invalid reply message id');
    }

    const resultCode = result.data.readUInt8(1);
    console.log(result.data);
    if (resultCode !== 0) {
      return false;
    }

    const numberOfFaces = result.data.readUInt16BE(2);


    const faceIds: number[] = [];

    for (let i = 0; i < numberOfFaces; i++) {
      faceIds.push(result.data.readUInt16BE(4 + i * 2));
    }



    return { numberOfFaces, faceIds };
  }


  async readEigenValue(faceId: number) {
    const data = Buffer.alloc(4);

    const sequenceNumber = 0x0f;
    const randomByte = Math.floor(Math.random() * 256);

    data.writeUInt8(randomByte, 0);
    data.writeUInt16BE(faceId, 1);
    data.writeUInt8(sequenceNumber, 3);

    const message = this.encodePackage({
      messageId: ReadEigenValueMessageId,
      data,
    });

    const result = await this.sendMessageAndReturnOutput(message);

    if (result.messageId !== 0) {
      throw new Error('Invalid message id');
    }

    const replyMessageId = result.data.readUInt8(0);

    if (replyMessageId !== ReadEigenValueMessageId) {
      throw new Error('Invalid reply message id');
    }

    const resultCode = result.data.readUInt8(1);

    if (resultCode !== 0) {
      return null;
    }

    const randomCodeReceived = result.data.readUInt8(2);

    if (randomCodeReceived !== randomByte) {
      throw new Error('Invalid random code');
    }

    const faceIdReceived = result.data.readUInt16BE(3);

    if (faceIdReceived !== faceId) {
      throw new Error('Invalid face id');
    }

    const receivedSequenceNumber = result.data.readUInt8(5);


    if (receivedSequenceNumber !== sequenceNumber) {
      throw new Error('Invalid sequence number');
    }

    const eigenValue = result.data.toString('hex', 6);


    return eigenValue;
  }


  async writeEigenValue(eigenValue: string) {

    const eigenData = Buffer.from(eigenValue, 'hex');

    const data = Buffer.alloc(eigenData.length + 2);

    const sequenceNumber = 0x0f;
    const randomByte = Math.floor(Math.random() * 256);

    data.writeUInt8(randomByte, 0);
    data.writeUInt8(sequenceNumber, 1);


    data.fill(eigenData, 2);

    const message = this.encodePackage({
      messageId: WriteEigenValueMessageId,
      data,
    });

    const result = await this.sendMessageAndReturnOutput(message);

    if (result.messageId !== 0) {
      throw new Error('Invalid message id');

    }
    const replyMessageId = result.data.readUInt8(0);

    if (replyMessageId !== WriteEigenValueMessageId) {
      throw new Error('Invalid reply message id');
    }

    const resultCode = result.data.readUInt8(1);

    if (resultCode !== 0) {

      if (resultCode === EigenFaceWriteIssues.FaceDuplication) {
        throw new Error('Face duplication');
      }



      return false;
    }

    const faceIdReceived = result.data.readUInt16BE(4);

    return faceIdReceived;
  }
}

