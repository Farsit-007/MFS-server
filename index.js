const express = require('express')
const app = express()
require('dotenv').config()
const bcrypt = require('bcrypt');
const cors = require('cors')
const jwt = require('jsonwebtoken');
const port = process.env.PORT || 5000

app.use(cors())
app.use(express.json())

const jwtSecret = 'kbsdkfbuiusd237448973644382';

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri =`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jy7vwoy.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


//middleware
const verifyToken = (req, res, next) => {
  // console.log('Inside THe verify Token',req.headers.authorization);
  if (!req.headers.authorization) {
    return res.status(401).send({ message: 'Unauthorized access' })
  }
  const token = req.headers.authorization.split(' ')[1]
  jwt.verify(token, jwtSecret, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: 'Forbidden access' })
    }
    req.decoded = decoded;
    next()
  })
}


async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const usersCollection = client.db('flikash').collection('users')
    const TransactionCollection = client.db('flikash').collection('transection')
    const CashInCollection = client.db('flikash').collection('CashIn_Req')

    //Register
    app.post('/register', async (req, res) => {
      const user = req.body;
      const exist = await usersCollection.findOne({ email: user.email })
      const exist2 = await usersCollection.findOne({ phone: user.phone })
      if (exist || exist2) {
        return res.status(304).send({ message: 'User Exists' })
      }
      const hashpassword = bcrypt.hashSync(user.password, 14);
      const result = await usersCollection.insertOne({ ...user, password: hashpassword })
      res.send(result)
    })

    //Login
    app.post('/login', async (req, res) => {
      const { email, phone, password } = req.body;
      const user = await usersCollection.findOne({ $or: [{ email }, { phone }] });
      if (!user) {
        return res.status(404).send({ message: 'Wrong Number/Email' });
      }
      const isPasswordMatch = await bcrypt.compare(password, user.password);
      if (!isPasswordMatch) {
        return res.status(401).send({ message: 'Wrong password' });
      }
      const token = jwt.sign(
        { userId: user._id, email: user.email, phone: user.phone },
        jwtSecret,
        { expiresIn: '1h' }
      );
      res.status(200).send({
        message: 'Login successful',
        token,
        user: { id: user._id, name: user.name, email: user.email, phone: user.phone }
      });
    });


    //Role
    app.get('/userRole/:email', async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email })
      res.send(result)
    })

    //Status
    app.get('/userStatus/:email', async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email })
      res.send(result)
    })

    //----Admin----
    //Status
    app.get('/allusers', verifyToken, async (req, res) => {
      const result = await usersCollection.find().toArray()
      res.send(result)
    })

    //Update Status for User / Agent
    app.patch('/adminupdatestatus/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const query = { _id: new ObjectId(id) };
      const user = await usersCollection.findOne(query);
      const updateDoc = { $set: { status } };
      if (user.role === 'user') {
        if (user.status !== 'active' && status === 'active' && !user.hasReceivedBonus) {
          updateDoc.$inc = { balance: 40 };
          updateDoc.$set.hasReceivedBonus = true;
        }
      } else if (user.role === 'agent') {
        if (user.status !== 'active' && status === 'active' && !user.hasReceivedBonus) {
          updateDoc.$inc = { balance: 10000 };
          updateDoc.$set.hasReceivedBonus = true;
        }
      }
      const result = await usersCollection.updateOne(query, updateDoc);
      res.send(result);
    });


    //User Balance 
    app.get('/userBalance/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const user = await usersCollection.findOne(query, { projection: { balance: 1 } });
      res.send({ balance: user.balance });
    });

    //Send Money
    app.patch('/sendMoeny', verifyToken, async (req, res) => {
      const { phone, amount, pin, senderId } = req.body;
      const sender = await usersCollection.findOne({ _id: new ObjectId(senderId) });
      const recipient = await usersCollection.findOne({ phone });

      const isPasswordMatch = await bcrypt.compare(pin, sender.password);
      if (recipient.role !== "user") {
        return res.status(400).send({ message: 'Recipient not found' });
      }
      if (!isPasswordMatch) {
        return res.status(401).send({ message: 'Wrong pin' });
      }
      if (sender.phone === recipient.phone) {
        return res.status(404).send({ message: 'Please,Provide a valid number' });
      }
      if (!sender) {
        return res.status(404).send({ message: 'Sender not found' });
      }
      if (!recipient) {
        return res.status(404).send({ message: 'Recipient not found' });
      }
      if (sender.balance < amount) {
        return res.status(400).send({ message: 'Insufficient balance' });
      }
      if (amount < 50) {
        return res.status(400).send({ message: 'Insufficient balance' });
      }
      if (amount > 100) {
        const cost = (amount + 5)
        const result = await usersCollection.updateOne({ _id: new ObjectId(senderId) }, { $inc: { balance: - cost } })
        const result1 = await usersCollection.updateOne({ phone: phone }, { $inc: { balance: amount } })
        const history = await TransactionCollection.insertOne({ sender, recipient, amount, result, result1, cost: cost - amount, createdAt: new Date(), type: "Send Money" })
        res.send({ result, result1 })
      } else {
        const result = await usersCollection.updateOne({ _id: new ObjectId(senderId) }, { $inc: { balance: - amount } })
        const result1 = await usersCollection.updateOne({ phone: phone }, { $inc: { balance: amount } })
        const history = await TransactionCollection.insertOne({ sender, recipient, amount, result, result1, createdAt: new Date(), type: "Send Money" })
        res.send({ result, result1 })
      }
    })

    //Cash Out
    app.patch('/cashout', verifyToken, async (req, res) => {
      const { phone, amount, pin, senderId } = req.body;
      const sender = await usersCollection.findOne({ _id: new ObjectId(senderId) });
      const recipient = await usersCollection.findOne({ phone });

      const isPasswordMatch = await bcrypt.compare(pin, sender.password);
      if (recipient.role !== "agent") {
        return res.status(400).send({ message: 'Recipient not found' });
      }
      if (!isPasswordMatch) {
        return res.status(400).send({ message: 'Wrong Pin' });
      }
      if (!sender) {
        return res.status(404).send({ message: 'Sender not found' });
      }
      if (!recipient) {
        return res.status(404).send({ message: 'Recipient not found' });
      }
      if (sender.balance < amount) {
        return res.status(400).send({ message: 'Insufficient balance' });
      }
      if (amount < 50) {
        return res.status(400).send({ message: 'Insufficient balance' });
      }
      const cost = (amount + (amount * (1.5 / 100)))
      const result = await usersCollection.updateOne({ _id: new ObjectId(senderId) }, { $inc: { balance: - cost } })
      const result1 = await usersCollection.updateOne({ phone: phone }, { $inc: { balance: amount + (cost - amount) } })
      const history = await TransactionCollection.insertOne({ sender, recipient, amount, cost: cost - amount, createdAt: new Date(), type: "Cash Out" })
      res.send({ result, result1 })

    })


    //Cash In From Agent
    app.post('/cashin', verifyToken, async (req, res) => {
      const { agent, amount, password, status, requesterId, requesterName, requesterPhone, requesterEmail } = req.body;
      const createdAt = new Date()
      const requestor = await usersCollection.findOne({ _id: new ObjectId(requesterId) });
      const FindAgent = await usersCollection.findOne({ phone: agent });
      const isPasswordMatch = await bcrypt.compare(password, requestor.password);
      if (!requestor) {
        return res.status(404).send({ message: 'Requestor not found' });
      }
      if (!FindAgent) {
        return res.status(404).send({ message: 'Agent not found' });
      }
      if (!isPasswordMatch) {
        return res.status(400).send({ message: 'Wrong Pin' });
      }
      const result = await CashInCollection.insertOne({ agent, amount, status, requesterId, requesterEmail, requesterName, requesterPhone, createdAt })
      res.send(result)
      console.log(result);
    })

    //Agent Transaction
    app.get('/Ag-Cashin/:phone', verifyToken, async (req, res) => {
      const phone = req.params.phone;
      const query = { agent: phone };
      const user = await CashInCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.send(user);
    });

    //Cash In Provide From Agent
    app.patch('/Ag-cashin/:id', verifyToken, async (req, res) => {
      const { status, amount, id, agentPhone, requesterPhone, pin } = req.body;
      const query = { _id: new ObjectId(id) }

      if (status === 'cancel') {
        const result3 = await CashInCollection.updateOne(query, { $set: { status: status } })
        res.send({ result3 })
      }
      else {
        const sender = await usersCollection.findOne({ phone: agentPhone });

        const isPasswordMatch = await bcrypt.compare(pin, sender.password);

        if (!isPasswordMatch) {
          return res.status(401).send({ message: 'Invalid password' });
        }

        const result3 = await CashInCollection.updateOne(query, { $set: { status: status } })
        if (status !== "cancel") {

          const recipient = await usersCollection.findOne({ phone: requesterPhone });

          if (!sender) {
            return res.status(404).send({ message: 'Sender not found' });
          }
          if (!recipient) {
            return res.status(404).send({ message: 'Recipient not found' });
          }
          if (sender.balance < amount) {
            return res.status(400).send({ message: 'Insufficient balance' });
          }
          if (amount < 50) {
            return res.status(400).send({ message: 'Insufficient balance' });
          }

          const result = await usersCollection.updateOne({ phone: agentPhone }, { $inc: { balance: - amount } })
          const result1 = await usersCollection.updateOne({ phone: requesterPhone }, { $inc: { balance: amount } })
          const history = await TransactionCollection.insertOne({ sender, recipient, cost: 0, amount, createdAt: new Date(), type: "Cash In" })
        }
        res.send({ result3 })
      }
    })

    //User Transaction History
    app.get('/US-transectionHistory/:phone', verifyToken, async (req, res) => {
      const phone = req.params.phone;
      const user = await TransactionCollection.find({ $or: [{ "sender.phone": phone }, { "recipient.phone": phone }] }).sort({ createdAt: -1 }).toArray();
      res.send(user);
    });

    //Admin System User 
    //=>Agent
    app.get('/AD-AG-Num', verifyToken, async (req, res) => {
      const result = await usersCollection.find({ role: 'agent' }).toArray();
      res.send(result)
    })
    // //=>Agent
    app.get('/AG-history/:phone', verifyToken, async (req, res) => {
      const phone = req.params.phone;

      const result = await TransactionCollection.find({ $or: [{ "sender.phone": phone }, { "recipient.phone": phone }] }).toArray()

      res.send(result)
    })
    //=>Agent
    app.get('/AG-details/:phone', verifyToken, async (req, res) => {
      const phone = req.params.phone;
      const result = await usersCollection.findOne({ phone })
      res.send(result)
    })

    //=>Agent
    app.get('/cash-count/:phone', verifyToken, async (req, res) => {
      const phone = req.params.phone;
      const result = await TransactionCollection.aggregate([
        {
          $match: {
            type: "Cash In",
            $or: [
              { "sender.phone": phone },
              { "recipient.phone": phone }
            ]
          }
        },
        {
          $group: {
            _id: phone,
            totalCashIn: {
              $sum: "$amount"  
            }
          }
        }
      ]).toArray();
      const result1 = await TransactionCollection.aggregate([
        {
          $match: {
            type: "Cash Out",
            $or: [
              { "sender.phone": phone },
              { "recipient.phone": phone }
            ]
          }
        },
        {
          $group: {
            _id: phone,
            totalCashOut: {
              $sum: "$amount"  
            }
          }
        }
      ]).toArray();
      const result2 = await TransactionCollection.aggregate([
        {
          $match: {
            $or: [
              { "sender.phone": phone },
              { "recipient.phone": phone }
            ]
          }
        },
        {
          $group: {
            _id: phone,
            totalCharge: {
              $sum: "$cost"  
            }
          }
        }
      ]).toArray();
      const cash = result.length > 0 ? result[0].totalCashIn : 0;
      const cashout = result1.length > 0 ? result1[0].totalCashOut : 0;
      const charge = result2.length > 0 ? result2[0].totalCharge : 0;
      res.send({cash,cashout,charge});
    })

    //=>User
    app.get('/AD-US-Num', verifyToken, async (req, res) => {
      const result = await usersCollection.find({ role: 'user' }).toArray();
      res.send(result)
    })
    //=>User
    app.get('/US-history/:phone', verifyToken, async (req, res) => {
      const phone = req.params.phone;
      const result = await TransactionCollection.find({ $or: [{ "sender.phone": phone }, { "recipient.phone": phone }] }).toArray()
      res.send(result)
    })
    // =>User
    app.get('/US-details/:phone', verifyToken, async (req, res) => {
      const phone = req.params.phone;
      const result = await usersCollection.findOne({ phone })
      res.send(result)
    })

     //=>User
     app.get('/money-count/:phone', verifyToken, async (req, res) => {
      const phone = req.params.phone;
      const result = await TransactionCollection.aggregate([
        {
          $match: {
            type: "Cash In",
            $or: [
              { "sender.phone": phone },
              { "recipient.phone": phone }
            ]
          }
        },
        {
          $group: {
            _id: phone,
            totalCashIn: {
              $sum: "$amount"  
            }
          }
        }
      ]).toArray();
      const result1 = await TransactionCollection.aggregate([
        {
          $match: {
            type: "Cash Out",
            $or: [
              { "sender.phone": phone },
              { "recipient.phone": phone }
            ]
          }
        },
        {
          $group: {
            _id: phone,
            totalCashOut: {
              $sum: "$amount"  
            }
          }
        }
      ]).toArray();
      const result2 = await TransactionCollection.aggregate([
        {
          $match: {
            $or: [
              { "sender.phone": phone },
              { "recipient.phone": phone }
            ]
          }
        },
        {
          $group: {
            _id: phone,
            totalCharge: {
              $sum: "$cost"  
            }
          }
        }
      ]).toArray();

      const result3 = await TransactionCollection.aggregate([
        {
          $match: {
            type: "Send Money",
            $or: [
              { "sender.phone": phone },
              { "recipient.phone": phone }
            ]
          }
        },
        {
          $group: {
            _id: phone,
            totalSend: {
              $sum: "$amount"  
            }
          }
        }
      ]).toArray();
      console.log(result3);

      const cash = result.length > 0 ? result[0].totalCashIn : 0;
      const cashout = result1.length > 0 ? result1[0].totalCashOut : 0;
      const charge = result2.length > 0 ? result2[0].totalCharge : 0;
      const send = result3.length > 0 ? result3[0].totalSend : 0;
      res.send({cash,cashout,charge,send});
    })



    console.log("You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Assignmnet-13 is running')
})

app.listen(port, () => {
  console.log(`Assignmnet-13 is running on ${port}`);
})