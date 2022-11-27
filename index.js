const express = require('express');
const app = express();
const jwt = require('jsonwebtoken');
const { query } = require('express');
var cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 5000;
require('dotenv').config();


//middleware
app.use(cors());
app.use(express.json());

//userName : doctorsPortal
//password : ytX9wKl4smzXwHhE


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ksaovkw.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


async function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized');
    };

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ massage: 'forbidden access' });
        }
        req.decoded = decoded;
        next();
    })

}

async function run() {
    try {
        const appointmentOptionsCollection = client.db("doctorsPortal").collection("appointmentOptions");
        const bookingsCollection = client.db("doctorsPortal").collection('bookingsCollection');
        const usersCollection = client.db("doctorsPortal").collection('usersCollection');
        const doctorsCollection = client.db("doctorsPortal").collection('doctorsCollection');

        app.get('/appointmentOptions', async (req, res) => {
            const date = req.query.date;
            const query = {};
            const options = await appointmentOptionsCollection.find(query).toArray();
            const bookingQuery = { appointmentDate: date };
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
                const bookedSlots = optionBooked.map(book => book.slot);
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots;
            });
            res.send(options);
        });

        app.get('/v2/appointmentOptions', async (req, res) => {
            const date = req.query.date;
            const options = await appointmentOptionsCollection.aggregate([
                {
                    $lookup: {
                        from: 'bookings',
                        localField: 'name',
                        foreignField: 'treatment',
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $eq: ['$appointmentDate', date]
                                    }
                                }
                            }
                        ],
                        as: 'booked'
                    }
                },
                {
                    $project: {
                        name: 1,
                        slots: 1,
                        booked: {
                            $map: {
                                input: '$booked',
                                as: 'book',
                                in: '$$book.slot'
                            }
                        }
                    }
                },
                {
                    $project: {
                        name: 1,
                        slots: {
                            $setDifference: ['$slots', '$booked']
                        }
                    }
                }
            ]).toArray();
            res.send(options);
        });


        app.get('/appointmentSpeciality', async (req, res) => {
            const query = {};
            const result = await appointmentOptionsCollection.find(query).project({ name: 1, }).toArray();
            res.send(result);
        });


        /* ---------------------------------------
            bookings are start-------------------------
        ---------------------------------------
         */

        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await bookingsCollection.find(query).toArray();
            res.send(result);
        })


        app.get('/bookings', verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;

            if (email !== decodedEmail) {
                return res.status(403).send({ massage: 'forbidden  access' })
            };

            const query = { email: email };
            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings);

        });

        app.post('/bookings', async (req, res) => {
            const booking = req.body;

            const query = {
                appointmentDate: booking.appointmentDate,
                email: booking.email,
                treatment: booking.treatment
            };
            const alreadyBooked = await bookingsCollection.find(query).toArray();

            if (alreadyBooked.length) {
                const message = `You already have a booking on ${booking.appointmentDate}`
                return res.send({ acknowledged: false, message })
            }

            const result = await bookingsCollection.insertOne(booking);
            res.send(result);

        });

        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
                return res.send({ accessToken: token })
            };
            res.status(403).send({ accessToken: 'Unauthorized' });
        });


        /* ---------------------------------------
        users  are start
        --------------------------------------
       */

        app.get('/users', async (req, res) => {
            const query = {};
            const users = await usersCollection.find(query).toArray();
            res.send(users);
        });

        app.post('/users', async (req, res) => {
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });


        /* ---------------------------------------
        admin  are start-------------------------
        ---------------------------------------
        */

        app.put('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const options = { upsert: true };
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc, options);
            res.send(result);
        });

        /* 
        ---------------------------------------------
        doctors are start 
        ----------------------------------------------
         */

        app.post('/doctors', async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        });


        app.get('/doctors', async (req, res) => {
            const query = {};
            const result = await doctorsCollection.find(query).toArray();
            res.send(result)
        });

        app.delete('/doctors/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result);
        });

        /* --------------------------------
          Payment System integrate 
          ------------------------------------ */

        app.get('/addprice', async (req, res) => {
            const filter = {};
            const options = { upsert: true };
            const updatedDoc = {
                $set: {
                    price: 99
                }
            }
            const result = await appointmentOptionsCollection.updateMany(filter, updatedDoc, options);
            res.send(result);
        });
    }

    finally {
        //   await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Doctors Portal Server Running!')
});

app.listen(port, () => {
    console.log(`Doctors Portal Server Running in Port ${port}`)
});
