// =============================================================
// CINESEARCH — Backend (Node.js + Express)
// Responsável por receber as requisições do Frontend e
// se comunicar com o banco de dados Elasticsearch (Bonsai).
// =============================================================

const express = require('express')
const cors    = require('cors')
const axios   = require('axios')
const bcrypt  = require('bcryptjs')       // 🆕 Criptografia de senha
const jwt     = require('jsonwebtoken')   // 🆕 Geração e verificação de token

const app = express()

// ---------------------------------------------------------------
// MIDDLEWARES
// ---------------------------------------------------------------
app.use(cors())
app.use(express.json())
app.use(express.static('public'))

// ---------------------------------------------------------------
// CONEXÃO COM O ELASTICSEARCH (Bonsai)
// ---------------------------------------------------------------
const BONSAI_URL  = 'https://2dbbdeb71e:f26ae00b5e4985883a9b@projeto-carioca-1ntc3trw.us-east-1.bonsaisearch.net'
const JWT_SECRET  = 'cinesearch_secret_2024' // 🆕 Chave para assinar os tokens JWT

// ---------------------------------------------------------------
// 🆕 GÊNEROS VÁLIDOS — regra de negócio
// ---------------------------------------------------------------
const GENEROS_VALIDOS = [
    'Ação', 'Aventura', 'Animação', 'Comédia', 'Crime',
    'Documentário', 'Drama', 'Fantasia', 'Ficção Científica',
    'Horror', 'Musical', 'Romance', 'Suspense', 'Terror', 'Western'
]

// ---------------------------------------------------------------
// 🆕 MIDDLEWARE DE AUTENTICAÇÃO
// Verifica se o token JWT é válido antes de rotas protegidas
// ---------------------------------------------------------------
function autenticar(req, res, next) {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1] // formato: "Bearer <token>"

    if (!token) {
        console.log('[AUTH] ❌ Token não fornecido')
        return res.status(401).json({ erro: 'Token não fornecido. Faça login.' })
    }

    try {
        const usuario = jwt.verify(token, JWT_SECRET)
        req.usuario = usuario // injeta os dados do usuário na requisição
        console.log(`[AUTH] ✅ Token válido — usuário: ${usuario.nome} (${usuario.id})`)
        next()
    } catch (err) {
        console.log('[AUTH] ❌ Token inválido ou expirado')
        return res.status(403).json({ erro: 'Token inválido ou expirado. Faça login novamente.' })
    }
}

// ---------------------------------------------------------------
// 🆕 ROTA: POST /usuarios/registro
// Cadastra um novo usuário no índice "usuarios" do Elasticsearch
// ---------------------------------------------------------------
app.post('/usuarios/registro', async (req, res) => {
    try {
        const { nome, email, senha } = req.body
        console.log(`[REGISTRO] Tentativa de registro — email: ${email}`)

        // ── Validações ──
        if (!nome || !email || !senha) {
            console.log('[REGISTRO] ❌ Campos obrigatórios faltando')
            return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios.' })
        }

        if (senha.length < 6) {
            console.log('[REGISTRO] ❌ Senha muito curta')
            return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres.' })
        }

        // Verifica se o email já está cadastrado
        const buscaEmail = await axios.post(`${BONSAI_URL}/usuarios/_search`, {
            query: { match: { email } }
        })

        if (buscaEmail.data.hits.total.value > 0) {
            console.log(`[REGISTRO] ❌ Email já cadastrado: ${email}`)
            return res.status(400).json({ erro: 'Este email já está cadastrado.' })
        }

        // Criptografa a senha antes de salvar
        const senhaHash = await bcrypt.hash(senha, 10)
        console.log(`[REGISTRO] 🔐 Senha criptografada com bcrypt (salt: 10)`)

        // Salva o usuário no Elasticsearch
        const resultado = await axios.post(`${BONSAI_URL}/usuarios/_doc`, {
            nome,
            email,
            senha: senhaHash,
            criado_em: new Date().toISOString()
        })

        console.log(`[REGISTRO] ✅ Usuário criado — id: ${resultado.data._id}, nome: ${nome}`)
        res.status(201).json({ mensagem: 'Usuário cadastrado com sucesso!' })

    } catch (err) {
        console.log(`[REGISTRO] 💥 Erro: ${err.message}`)
        res.status(500).json({ erro: err.message })
    }
})

// ---------------------------------------------------------------
// 🆕 ROTA: POST /usuarios/login
// Verifica email e senha, retorna um token JWT se válido
// ---------------------------------------------------------------
app.post('/usuarios/login', async (req, res) => {
    try {
        const { email, senha } = req.body
        console.log(`[LOGIN] Tentativa de login — email: ${email}`)

        if (!email || !senha) {
            return res.status(400).json({ erro: 'Email e senha são obrigatórios.' })
        }

        // Busca o usuário pelo email
        const resultado = await axios.post(`${BONSAI_URL}/usuarios/_search`, {
            query: { match: { email } }
        })

        if (resultado.data.hits.total.value === 0) {
            console.log(`[LOGIN] ❌ Email não encontrado: ${email}`)
            return res.status(401).json({ erro: 'Email ou senha incorretos.' })
        }

        const usuario = resultado.data.hits.hits[0]
        const dadosUsuario = usuario._source

        // Compara a senha digitada com o hash salvo no banco
        const senhaCorreta = await bcrypt.compare(senha, dadosUsuario.senha)

        if (!senhaCorreta) {
            console.log(`[LOGIN] ❌ Senha incorreta para: ${email}`)
            return res.status(401).json({ erro: 'Email ou senha incorretos.' })
        }

        // Gera o token JWT com os dados do usuário (expira em 8 horas)
        const token = jwt.sign(
            { id: usuario._id, nome: dadosUsuario.nome, email: dadosUsuario.email },
            JWT_SECRET,
            { expiresIn: '8h' }
        )

        console.log(`[LOGIN] ✅ Login bem-sucedido — ${dadosUsuario.nome} (${usuario._id})`)
        res.json({
            mensagem: 'Login realizado com sucesso!',
            token,
            usuario: { id: usuario._id, nome: dadosUsuario.nome, email: dadosUsuario.email }
        })

    } catch (err) {
        console.log(`[LOGIN] 💥 Erro: ${err.message}`)
        res.status(500).json({ erro: err.message })
    }
})

// ---------------------------------------------------------------
// ROTA: POST /filmes
// 🆕 Agora exige autenticação + validações de negócio
// ---------------------------------------------------------------
app.post('/filmes', autenticar, async (req, res) => {
    try {
        const { titulo, genero, sinopse, ano } = req.body
        console.log(`[CADASTRO] Filme: "${titulo}" — usuário: ${req.usuario.nome}`)

        // ── 🆕 Validações de negócio ──

        if (!titulo || !genero || !sinopse || !ano) {
            console.log('[CADASTRO] ❌ Campos obrigatórios faltando')
            return res.status(400).json({ erro: 'Todos os campos são obrigatórios.' })
        }

        if (titulo.trim().length < 2) {
            console.log('[CADASTRO] ❌ Título muito curto')
            return res.status(400).json({ erro: 'O título deve ter pelo menos 2 caracteres.' })
        }

        if (!GENEROS_VALIDOS.includes(genero)) {
            console.log(`[CADASTRO] ❌ Gênero inválido: ${genero}`)
            return res.status(400).json({ erro: 'Gênero inválido.' })
        }

        const anoNum = parseInt(ano)
        const anoAtual = new Date().getFullYear()
        if (isNaN(anoNum) || anoNum < 1888 || anoNum > anoAtual + 1) {
            console.log(`[CADASTRO] ❌ Ano inválido: ${ano}`)
            return res.status(400).json({ erro: `Ano inválido. Use um valor entre 1888 e ${anoAtual + 1}.` })
        }

        if (sinopse.trim().length < 10) {
            console.log('[CADASTRO] ❌ Sinopse muito curta')
            return res.status(400).json({ erro: 'A sinopse deve ter pelo menos 10 caracteres.' })
        }

        if (sinopse.trim().length > 1000) {
            console.log('[CADASTRO] ❌ Sinopse muito longa')
            return res.status(400).json({ erro: 'A sinopse deve ter no máximo 1000 caracteres.' })
        }

        // 🆕 Verifica se já existe um filme com o mesmo título
        const buscaDuplicado = await axios.post(`${BONSAI_URL}/filmes/_search`, {
            query: { match_phrase: { titulo: titulo.trim() } }
        })

        if (buscaDuplicado.data.hits.total.value > 0) {
            console.log(`[CADASTRO] ❌ Título duplicado: "${titulo}"`)
            return res.status(400).json({ erro: 'Já existe um filme cadastrado com este título.' })
        }

        // 🆕 Salva o filme com o autor_id (quem cadastrou)
        await axios.post(`${BONSAI_URL}/filmes/_doc`, {
            titulo: titulo.trim(),
            genero,
            sinopse: sinopse.trim(),
            ano: anoNum,
            autor_id: req.usuario.id,       // 🆕 ID do usuário que cadastrou
            autor_nome: req.usuario.nome,   // 🆕 Nome do usuário que cadastrou
            criado_em: new Date().toISOString()
        })

        console.log(`[CADASTRO] ✅ Filme "${titulo}" cadastrado por ${req.usuario.nome}`)
        res.status(201).json({ mensagem: 'Filme cadastrado com sucesso!' })

    } catch (err) {
        console.log(`[CADASTRO] 💥 Erro: ${err.message}`)
        res.status(500).json({ erro: err.message })
    }
})

// ---------------------------------------------------------------
// ROTA: GET /filmes?q=termo
// Pública — qualquer um pode buscar filmes
// ---------------------------------------------------------------
app.get('/filmes', async (req, res) => {
    try {
        const { q } = req.query
        console.log(`[BUSCA] Termo: "${q || '(todos)'}"`)

        const query = q ? {
            multi_match: { query: q, fields: ['titulo', 'genero', 'sinopse'] }
        } : { match_all: {} }

        const resultado = await axios.post(`${BONSAI_URL}/filmes/_search`, { query })
        const filmes = resultado.data.hits.hits.map(h => ({ _id: h._id, ...h._source }))

        console.log(`[BUSCA] ✅ ${filmes.length} filme(s) encontrado(s)`)
        res.json(filmes)

    } catch (err) {
        console.log(`[BUSCA] 💥 Erro: ${err.message}`)
        res.status(500).json({ erro: err.message })
    }
})

// ---------------------------------------------------------------
// ROTA: PUT /filmes/:id
// 🆕 Exige autenticação + verifica se o usuário é o dono do filme
// ---------------------------------------------------------------
app.put('/filmes/:id', autenticar, async (req, res) => {
    try {
        const { titulo, genero, sinopse, ano } = req.body
        const { id } = req.params
        console.log(`[EDITAR] Filme id: ${id} — usuário: ${req.usuario.nome}`)

        // ── 🆕 Validações ──
        if (!titulo || !genero || !sinopse || !ano) {
            return res.status(400).json({ erro: 'Todos os campos são obrigatórios.' })
        }

        if (!GENEROS_VALIDOS.includes(genero)) {
            return res.status(400).json({ erro: 'Gênero inválido.' })
        }

        const anoNum = parseInt(ano)
        const anoAtual = new Date().getFullYear()
        if (isNaN(anoNum) || anoNum < 1888 || anoNum > anoAtual + 1) {
            return res.status(400).json({ erro: `Ano inválido. Use um valor entre 1888 e ${anoAtual + 1}.` })
        }

        if (sinopse.trim().length < 10) {
            return res.status(400).json({ erro: 'A sinopse deve ter pelo menos 10 caracteres.' })
        }

        // 🆕 Busca o filme para verificar se o usuário é o dono
        const filmeAtual = await axios.get(`${BONSAI_URL}/filmes/_doc/${id}`)
        const dono = filmeAtual.data._source.autor_id

        if (dono !== req.usuario.id) {
            console.log(`[EDITAR] ❌ Acesso negado — dono: ${dono}, solicitante: ${req.usuario.id}`)
            return res.status(403).json({ erro: 'Você só pode editar filmes que você cadastrou.' })
        }

        // Atualiza mantendo o autor original
        await axios.put(`${BONSAI_URL}/filmes/_doc/${id}`, {
            titulo: titulo.trim(),
            genero,
            sinopse: sinopse.trim(),
            ano: anoNum,
            autor_id: dono,
            autor_nome: filmeAtual.data._source.autor_nome,
            criado_em: filmeAtual.data._source.criado_em,
            atualizado_em: new Date().toISOString()
        })

        console.log(`[EDITAR] ✅ Filme "${titulo}" atualizado por ${req.usuario.nome}`)
        res.json({ mensagem: 'Filme atualizado com sucesso!' })

    } catch (err) {
        console.log(`[EDITAR] 💥 Erro: ${err.message}`)
        res.status(500).json({ erro: err.message })
    }
})

// ---------------------------------------------------------------
// ROTA: DELETE /filmes/:id
// 🆕 Exige autenticação + verifica se o usuário é o dono do filme
// ---------------------------------------------------------------
app.delete('/filmes/:id', autenticar, async (req, res) => {
    try {
        const { id } = req.params
        console.log(`[DELETAR] Filme id: ${id} — usuário: ${req.usuario.nome}`)

        // 🆕 Busca o filme para verificar se o usuário é o dono
        const filmeAtual = await axios.get(`${BONSAI_URL}/filmes/_doc/${id}`)
        const dono = filmeAtual.data._source.autor_id

        if (dono !== req.usuario.id) {
            console.log(`[DELETAR] ❌ Acesso negado — dono: ${dono}, solicitante: ${req.usuario.id}`)
            return res.status(403).json({ erro: 'Você só pode deletar filmes que você cadastrou.' })
        }

        await axios.delete(`${BONSAI_URL}/filmes/_doc/${id}`)

        console.log(`[DELETAR] ✅ Filme id: ${id} deletado por ${req.usuario.nome}`)
        res.json({ mensagem: 'Filme deletado com sucesso!' })

    } catch (err) {
        console.log(`[DELETAR] 💥 Erro: ${err.message}`)
        res.status(500).json({ erro: err.message })
    }
})

// ---------------------------------------------------------------
// INICIALIZAÇÃO DO SERVIDOR
// ---------------------------------------------------------------
app.listen(process.env.PORT || 3000, () => console.log('🎬 CineSearch rodando!'))