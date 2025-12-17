const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

// --- 1. CONFIGURACIÓN ---
const PORT = 3000; 

// 🔐 CREDENCIALES
const USUARIO = "admin";
const PASSWORD = "123"; 

// ⏳ TIEMPO DE VIDA DE ARCHIVOS (30 DÍAS)
const DIAS_PARA_BORRAR = 30; 

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/') },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext)
    }
});
const upload = multer({ storage: storage });

// --- FUNCIÓN DE LIMPIEZA AUTOMÁTICA 🧹 ---
const limpiarArchivosViejos = () => {
    const carpeta = 'uploads/';
    fs.readdir(carpeta, (err, files) => {
        if (err) return console.error("Error leyendo carpeta uploads");
        
        files.forEach(file => {
            const rutaCompleta = path.join(carpeta, file);
            fs.stat(rutaCompleta, (err, stats) => {
                if (err) return;
                const ahora = new Date().getTime();
                const fechaArchivo = new Date(stats.birthtime).getTime();
                const diasDeVida = (ahora - fechaArchivo) / (1000 * 3600 * 24);

                if (diasDeVida > DIAS_PARA_BORRAR) {
                    fs.unlink(rutaCompleta, (err) => {
                        if (!err) console.log(`🗑️ Auto-limpieza: Se borró ${file}`);
                    });
                }
            });
        });
    });
};

// --- 2. MIDDLEWARE DE SEGURIDAD (PORTERO) ---
const portero = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic');
        return res.status(401).send('🔒 Acceso Denegado');
    }
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    if (auth[0] === USUARIO && auth[1] === PASSWORD) {
        next(); 
    } else {
        res.setHeader('WWW-Authenticate', 'Basic');
        return res.status(401).send('❌ Contraseña incorrecta');
    }
};

// --- 3. RUTAS ---

// Panel Admin Protegido
app.get('/admin.html', portero, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// --- RUTA DE PUBLICACIÓN (MODIFICADA PARA GALERÍA) ---
// Ahora usamos .array() en lugar de .single() para recibir varias fotos
app.post('/publicar', portero, upload.array('archivos', 10), (req, res) => {
    try {
        // Revisamos si llegaron archivos
        if (!req.files || req.files.length === 0) return res.status(400).send('Falta archivo');
        
        limpiarArchivosViejos(); // Limpiamos basura vieja

        const target = req.body.target || 'all';
        
        // --- LÓGICA INTELIGENTE ---
        
        // CASO A: Es una GALERÍA (Más de 1 archivo)
        if (req.files.length > 1) {
            // Creamos una lista con las URLs de todas las fotos
            const urls = req.files.map(file => `/uploads/${file.filename}`);
            console.log(`📡 Enviando Galería de ${req.files.length} fotos a: ${target}`);
            
            // Le decimos a la TV: "Oye, aquí va un paquete de fotos (gallery)"
            io.emit('contentUpdate', { target, type: 'gallery', urls: urls });
        }
        
        // CASO B: Es UN SOLO ARCHIVO (Video, Excel o 1 sola foto)
        else {
            const file = req.files[0];
            const mime = file.mimetype;
            const filePath = `/uploads/${file.filename}`;

            console.log(`📡 Enviando Archivo Único a: ${target}`);

            if (file.originalname.endsWith('.xlsx') || mime.includes('spreadsheet')) {
                const wb = xlsx.readFile(file.path);
                const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
                io.emit('contentUpdate', { target, type: 'table', data: data });
            } 
            else if (mime.includes('video')) {
                io.emit('contentUpdate', { target, type: 'video', url: filePath });
            }
            else {
                // Si es una sola imagen, la mandamos como 'image' normal
                io.emit('contentUpdate', { target, type: 'image', url: filePath });
            }
        }
        
        res.send({ status: 'ok', message: 'Enviado correctamente' });

    } catch (e) {
        console.error("Error en publicación:", e);
        res.status(500).send('Error interno');
    }
});

// CACHÉ (1 AÑO)
app.use(express.static('public')); 
app.use('/uploads', express.static('uploads', { maxAge: '1y', immutable: true })); 

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// --- 4. SOCKET ---
io.on('connection', (socket) => {
    console.log('Cliente conectado');
    socket.on('join', (room) => socket.join(room));
});

http.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});