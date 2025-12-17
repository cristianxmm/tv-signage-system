const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const multer = require('multer'); // Necesario instalar: npm install multer
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

// --- CONFIGURACIÓN ---
const PORT = 80; 

// Configuración para guardar archivos manteniendo su extensión
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        // Evitar nombres duplicados usando la fecha
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext)
    }
});
const upload = multer({ storage: storage });

app.use(express.static('public'));
// Permitir acceso a la carpeta uploads para que la TV vea las fotos/videos
app.use('/uploads', express.static('uploads')); 

// Crear carpeta uploads si no existe
if (!fs.existsSync('uploads')){
    fs.mkdirSync('uploads');
}

// --- RUTAS ---

app.post('/publicar', upload.single('archivo'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No se subió ningún archivo.');
        }

        const target = req.body.target || 'all';
        const mimeType = req.file.mimetype;
        const filePath = `/uploads/${req.file.filename}`; 

        console.log(`📡 Enviando contenido a: ${target} | Tipo: ${mimeType}`);

        // DETECTAR TIPO DE ARCHIVO
        
        // 1. EXCEL
        if (req.file.originalname.endsWith('.xlsx') || mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
            const workbook = xlsx.readFile(req.file.path);
            const sheetName = workbook.SheetNames[0];
            const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
            
            io.emit('contentUpdate', { target, type: 'table', data: data });
        } 
        // 2. IMAGEN
        else if (mimeType.includes('image')) {
            io.emit('contentUpdate', { target, type: 'image', url: filePath });
        }
        // 3. VIDEO
        else if (mimeType.includes('video')) {
            io.emit('contentUpdate', { target, type: 'video', url: filePath });
        }
        else {
            return res.status(400).send('Formato no soportado. Usa .xlsx, .jpg, .png o .mp4');
        }

        res.send({ status: 'ok', message: 'Contenido enviado a ' + target });

    } catch (error) {
        console.error(error);
        res.status(500).send('Error procesando el archivo');
    }
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('⚡ Nueva TV Conectada');
    
    // Unir la TV a su sala correspondiente (ej: "recepcion")
    socket.on('join', (room) => {
        socket.join(room);
        console.log(`📺 TV se unió al canal: ${room}`);
    });
});

// --- INICIO ---
http.listen(PORT, () => {
    console.log(`🚀 Servidor Multimedia corriendo en http://localhost:${PORT}`);
});