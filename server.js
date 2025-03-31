const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const app = express();
const port = 3000;

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());

// Omogućavamo statičke fajlove (slike) iz direktorijuma 'public'
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// Kreiranje konekcije s bazom
const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'web',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const JWT_SECRET = 'tvoj_tajni_kljuc';

// Middleware za provjeru JWT tokena (ako je potrebno kasnije)
// const authenticateJWT = (req, res, next) => {
//   const token = req.header('Authorization')?.split(' ')[1]; // 'Bearer token' format
//   if (!token) {
//     return res.status(403).send({ status: 'error', message: 'Prvo se prijavite.' });
//   }
//
//   jwt.verify(token, JWT_SECRET, (err, user) => {
//     if (err) {
//       return res.status(403).send({ status: 'error', message: 'Neispravan ili istekao token.' });
//     }
//     req.user = user;
//     next();
//   });
// };

// Ruta za login
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).send({ status: 'error', message: 'Korisničko ime i lozinka su obavezni!' });
  }
  const query = 'SELECT * FROM users WHERE username = ?';
  db.query(query, [username], (err, results) => {
    if (err) return res.status(500).send({ status: 'error', message: 'Greška pri prijavi.' });
    if (results.length === 0) return res.status(401).send({ status: 'error', message: 'Pogrešno korisničko ime.' });
    
    const user = results[0];
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) return res.status(500).send({ status: 'error', message: 'Greška pri provjeri lozinke.' });
      if (!isMatch) return res.status(401).send({ status: 'error', message: 'Pogrešna lozinka.' });
      
      const token = jwt.sign({ id: user.id, username: user.username, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '1h' });
      res.send({ status: 'success', message: 'Prijava uspješna!', token });
    });
  });
});

// Konfiguracija za multer - za upload slika
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/images');  // Odredi direktorij za spremanje slika
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);  // Ekstenzija fajla
    cb(null, Date.now() + ext);  // Spremi sliku sa jedinstvenim imenom
  }
});
const upload = multer({ storage: storage });

// Ruta za dodavanje novosti sa slikom
app.post('/add-news', upload.single('slika'), (req, res) => {
  const { naslov, opis, short } = req.body;  // Prvo uzimamo tekstualne podatke
  const slika = req.file;  // Uzima se slika

  // Provera da li su svi podaci prisutni
  if (!naslov || !opis || !short || !slika) {
      return res.status(400).json({ status: 'error', message: 'Svi podaci moraju biti popunjeni!' });
  }

  // Spremanje u bazu podataka
  const query = 'INSERT INTO news (title, content, short, image_path) VALUES (?, ?, ?, ?)';
  const values = [naslov, opis, short, `images/${slika.filename}`];

  db.query(query, values, (err, result) => {
      if (err) {
          console.error('Greška pri dodavanju novosti:', err);
          return res.status(500).json({ status: 'error', message: 'Greška pri dodavanju novosti' });
      }
      res.json({ status: 'success', message: 'Novost je uspešno dodana!' });
  });
});



// Ruta za dohvat broja objava
app.get('/get-news-count', (req, res) => {
  db.query('SELECT COUNT(*) AS count FROM news', (err, result) => {
    if (err) {
      console.error('Greška pri dohvatku broja objava:', err);
      return res.status(500).send({ status: 'error', message: 'Greška pri dohvatku broja objava.' });
    }
    res.send({ count: result[0].count });
  });
});

// Endpoint za dohvat novosti sa paginacijom
app.get('/get-news', (req, res) => {
  const page = parseInt(req.query.page) || 1;  // Podrazumevana stranica je 1
  const limit = parseInt(req.query.limit) || 6;  // Uzmimo limit sa klijenta, podrazumevano 6
  const offset = (page - 1) * limit;  // Izračunavanje offseta

  console.log(`Paginacija: Stranica ${page}, Limit ${limit}, Offset ${offset}`);

  // SQL upit za dohvat novosti sortirano po datumu objave
  db.query('SELECT * FROM news ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset], (err, results) => {
      if (err) {
          console.error('Greška pri dohvatku novosti:', err);
          return res.status(500).send({ status: 'error', message: 'Greška pri dohvatku novosti.' });
      }

      // Dohvati broj ukupnih novosti za izračunavanje broja stranica
      db.query('SELECT COUNT(*) AS count FROM news', (err, countResult) => {
          if (err) {
              console.error('Greška pri dohvatku broja novosti:', err);
              return res.status(500).send({ status: 'error', message: 'Greška pri dohvatku broja novosti.' });
          }

          const totalNewsCount = countResult[0].count;
          const totalPages = Math.ceil(totalNewsCount / limit);

          res.json({
              novosti: results,
              totalPages: totalPages
          });
      });
  });
});


// Ruta za brisanje novosti
app.delete('/delete-news/:id', (req, res) => {
  const newsId = req.params.id;
  const query = 'DELETE FROM news WHERE id = ?';
  db.query(query, [newsId], (err, result) => {
    if (err) {
      console.error('❌ Greška pri brisanju novosti:', err);
      return res.status(500).send({ status: 'error', message: 'Greška pri brisanju novosti.' });
    }

    res.send({ status: 'success', message: '✅ Novost uspješno obrisana!' });
  });
});



// Ruta za ažuriranje novosti
app.post('/update-news/:id', upload.single('image'), (req, res) => {
  const { title, content, short } = req.body;
  const image = req.file ? `images/${req.file.filename}` : null;  // Ako je nova slika, uzmi je, inače ostavi staru

  if (!title || !content || !short) {
      return res.status(400).json({ status: 'error', message: 'Naslov, opis i kratki opis su obavezni!' });
  }

  let query = 'UPDATE news SET title = ?, content = ?, short = ?';
  const values = [title, content, short];

  if (image) {
      query += ', image_path = ?';
      values.push(image);
  }

  query += ' WHERE id = ?';
  values.push(req.params.id);

  db.query(query, values, (err, result) => {
      if (err) {
          console.error('Greška pri ažuriranju novosti:', err);
          return res.status(500).json({ status: 'error', message: 'Greška pri ažuriranju novosti' });
      }
      res.json({ status: 'success', message: 'Novost uspešno izmenjena!' });
  });
});

// Pretpostavljamo da koristiš MongoDB i Mongoose


// API za učitavanje novosti sa paginacijom
// Endpoint za dohvat novosti sa paginacijom
app.get('/dohvati-novosti', (req, res) => {
  const page = parseInt(req.query.page) || 1;  // Ako stranica nije prosleđena, podrazumevana je 1
  const limit = 6;  // Broj novosti po stranici
  const offset = (page - 1) * limit;  // Offset za SQL upit

  console.log(`Paginacija: Stranica ${page}, Limit ${limit}, Offset ${offset}`);  // Log za proveru

  // SQL upit za dohvat novosti sa paginacijom
  db.query('SELECT * FROM news LIMIT ? OFFSET ?', [limit, offset], (err, results) => {
      if (err) {
          console.error('Greška pri dohvatku novosti:', err);
          return res.status(500).send({ status: 'error', message: 'Greška pri dohvatku novosti.' });
      }
      
      console.log(`Dohvaćene novosti: ${results.length} novosti`);  // Log za broj novosti koji se vraća
      res.json({ novosti: results });
  });
});

// Endpoint za dohvat broja novosti u bazi
app.get('/dohvati-broj-novosti', (req, res) => {
  db.query('SELECT COUNT(*) AS count FROM news', (err, result) => {
      if (err) {
          console.error('Greška pri dohvatku broja novosti:', err);
          return res.status(500).send({ status: 'error', message: 'Greška pri dohvatku broja novosti.' });
      }
      
      console.log(`Ukupno novosti: ${result[0].count}`);  // Log za broj novosti u bazi
      res.send({ count: result[0].count });
  });
});



// Pokretanje servera
app.listen(port, () => console.log(`🚀 Server pokrenut na portu ${port}`));
