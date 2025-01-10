const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const jwt = require('jsonwebtoken')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');



// middleware
app.use(cors())
app.use(express.json())



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.llz6n.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const userCollection = client.db('bistroDb').collection('users');
    const menuCollection = client.db('bistroDb').collection('menu');
    const reviewCollection = client.db('bistroDb').collection('reviews');
    const cartCollection = client.db('bistroDb').collection('carts');
    const paymentCollection = client.db('bistroDb').collection('payments');

    // jwt related api
    app.post('/jwt', async(req,res) =>{
      const user = req.body ; //info come from client site
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECURE, {
        expiresIn : '365d'
      })  //set user as a payload
      res.send({token});
    })

    // middlewares
    const verifyToken = (req,res,next)=>{
      console.log('verify token', req.headers.authorization);
      if(!req.headers.authorization){
        return res.status(401).send({message : 'forbidden access'})
      }
      const token = req.headers.authorization.split(' ')[1]
      jwt.verify(token, process.env.ACCESS_TOKEN_SECURE, (error,decoded) =>{
        if(error){
          return res.status(401).send({message : 'forbidden access'})
        }
        req.decoded = decoded;
        next()
      })
    }
    // use verify admin after verifying
    const verifyAdmin = async(req,res,next) =>{
      const email = req.decoded.email;
       const query = {email : email};
       const user = await userCollection.findOne(query);
       const isAdmin = user?.role === 'admin';
       if(!isAdmin){
        return res.status(403).send({message : 'forbidden access'})
       }
       next();
    }

    // user related db
    app.get('/users',verifyToken,verifyAdmin, async(req,res) =>{
      const result = await userCollection.find().toArray();
      res.send(result);
    })

    // admin api 
    app.get('/users/admin/:email', verifyToken, async(req, res) =>{
      const email = req.params.email;
      if(email !== req.decoded.email){
        return res.status(403).send({message : 'unauthorized access'})
      }
      const query = {email : email};
      const user = await userCollection.findOne(query);
      let admin = false;
      if(user){
        admin = user?.role === 'admin'
      }
      res.send({admin})
    })
     
    app.post('/users', async(req,res) =>{
      const user = req.body;
      // insert email if user does not exists
      // you can do this many way(1.email 2.upsert 3.simple checking)
      const query = {email : user.email}
      const existingUser = await userCollection.findOne(query);
      if(existingUser){
        return res.send({message :'user already exists', insertedId : null})
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    })

    // handle make admin api
    app.patch('/users/admin/:id',verifyToken,verifyAdmin, async(req,res) =>{
      const id = req.params.id;
      const filter = {_id : new ObjectId(id)};
      const updateDoc={
        $set:{
          role : 'admin'
        }
      }
      const result = await userCollection.updateOne(filter,updateDoc);
      res.send(result);
    })

    app.delete('/users/:id',verifyToken,verifyAdmin, async(req,res) =>{
      const id = req.params.id;
      const query = {_id : new ObjectId(id)};
      const result = await userCollection.deleteOne(query);
      res.send(result);
    })



// menu related data
    // getting menu data
    app.get('/menu', async(req, res) =>{
        const result = await menuCollection.find().toArray();
        res.send(result)
    })
    app.get('/menu/:id', async (req, res) => {
        const id = req.params.id;
        const query = { _id: id };
        const result = await menuCollection.findOne(query);
        res.send(result);
    });
    

    app.post('/menu',verifyToken,verifyAdmin, async(req,res) =>{
      const item = req.body;
      const result = await menuCollection.insertOne(item);
      res.send(result);
    })

    app.patch('/menu/:id', async(req,res) =>{
      const item = req.body;
      const id = req.params.id;
      const filter = { _id : id};
      const updateDoc ={
        $set:{
          name : item.name,
          category:item.category,
          price: item.price,
          recipe:item.recipe,
          image : item.image
        }
      }
      console.log("Updating Menu Item:", { filter, updateDoc });
      const result = await menuCollection.updateOne(filter,updateDoc);
      res.send(result); 
    })

    app.delete('/menu/:id',verifyToken,verifyAdmin, async(req,res) =>{
      const id = req.params.id;
      const query = {_id : new ObjectId(id)};
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    })


    // getting reviews data
    app.get('/reviews', async(req, res) =>{
        const result = await reviewCollection.find().toArray();
        res.send(result);   
    })
// ------------------carts collection-----------------------
    //  cart collection (get in navbar)
    app.get('/carts', async(req,res) =>{
      const email = req.query.email;
      const query = {email : email }
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    })

    // cart collection (post)
    app.post('/carts', async(req,res) =>{
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem);
      res.send(result)
    })

    // delete specific id
    app.delete('/carts/:id', async(req, res) =>{
      const id = req.params.id;
      const query = {_id : new ObjectId(id)};
      const result = await cartCollection.deleteOne(query);
      res.send(result)
    })

    // payment intent ------related api-----
    app.post('/create-payment-intent', async(req,res) =>{
      const {price} = req.body;
      const amount = parseInt(price * 100)
      
      const paymentIntent = await stripe.paymentIntents.create({
        amount:amount,
        currency:'usd',
        payment_method_types:['card']
      });
      res.send({
        clientSecret: paymentIntent.client_secret
      })
    })

    app.get('/payments/:email',verifyToken, async(req,res) =>{
      const query = {email : req.params.email}
      if(req.params.email !== req.decoded.email) return res.status(403).send({message: 'forbidden access'})
      const result = await paymentCollection.find(query).toArray();
      res.send(result)
    })

    app.post('/payments', async(req,res) =>{
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);

      // carefully delete each item from the cart
      const query ={_id : {
        $in: payment.cartIds.map(id => new ObjectId(id))
      }}
      const deleteResult = await cartCollection.deleteMany(query) 
     res.send({paymentResult, deleteResult})

    })

    //stats or analytics
    app.get('/admin-stats',verifyToken,verifyAdmin, async(req,res) =>{
      const users = await userCollection.estimatedDocumentCount();
      const menuItems = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();

      // this is not a best way
      // const payments = await paymentCollection.find().toArray();
      // const revenue = payments.reduce((total, payment) => total + payment.price,0)

      // this is best way
      const  result = await paymentCollection.aggregate([
        {
          $group:{
            _id : null,
            totalRevenue:{
              $sum:'$price'
            }
          }
        }
      ]).toArray();
      const revenue = result.length > 0 ? result[0].totalRevenue : 0;

      res.send({
        users,
        menuItems,
        orders,
        revenue,


      }) 
    })

    // using aggregate pipeline
    app.get('/order-stats',verifyToken,verifyAdmin, async(req,res) =>{
      const result = await paymentCollection.aggregate([
       {
        $unwind: '$menuItemIds'
       },
       {
        $lookup:{
          from:'menu',
          localField:'menuItemIds',
          foreignField: '_id',
          as: 'menuItems'
        }
       },
       {
        $unwind:'$menuItems'
       },
       {
        $group:{
          _id: '$menuItems.category',
          quantity: {$sum:1},
          revenue:{$sum:'$menuItems.price'}
        }
       },
       {
        $project:{
          _id:0,
          category:'$_id',
          quantity:'$quantity',
          revenue:'$revenue'
        }
       }


      ]).toArray();
      res.send(result)
    })







    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);





app.get('/', (req,res) =>{
    res.send('boss is buying')
})
app.listen(port, () =>{
    console.log(`bistro boss is sitting on port ${port}`)
})