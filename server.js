// =============================================================
// CINESEARCH — Backend (Node.js + Express)
// Responsável por receber as requisições do Frontend e
// se comunicar com o banco de dados Elasticsearch (Bonsai).
// =============================================================

const express = require('express')  // Framework para criar o servidor HTTP
const cors = require('cors')        // Permite requisições do Frontend (cross-origin)
const axios = require('axios')      // Cliente HTTP para comunicar com o Elasticsearch

const app = express()

// ---------------------------------------------------------------
// MIDDLEWARES
// Configurações globais aplicadas em todas as requisições
// ---------------------------------------------------------------
app.use(cors())             // Libera o Frontend (localhost:3000) para chamar o Backend
app.use(express.json())     // Converte o corpo das requisições de JSON para objeto JS
app.use(express.static('public')) // Serve os arquivos estáticos do Frontend (index.html)

// ---------------------------------------------------------------
// CONEXÃO COM O ELASTICSEARCH (Bonsai)
// URL contém: protocolo + usuário + senha + host do cluster
// Formato: https://[usuario]:[senha]@[host]
// ---------------------------------------------------------------
const BONSAI_URL = 'https://2dbbdeb71e:f26ae00b5e4985883a9b@projeto-carioca-1ntc3trw.us-east-1.bonsaisearch.net'

// ---------------------------------------------------------------
// ROTA: POST /filmes
// Frontend → Backend → Elasticsearch
// Recebe os dados do formulário e cria um novo documento no índice "filmes"
// ---------------------------------------------------------------
app.post('/filmes', async (req, res) => {
    try {
        const { titulo, genero, sinopse, ano } = req.body // Dados vindos do Frontend

        // Envia o documento para o Elasticsearch via HTTP POST
        // O Elasticsearch gera um _id automaticamente para o documento
        await axios.post(`${BONSAI_URL}/filmes/_doc`, { titulo, genero, sinopse, ano })

        res.json({ mensagem: 'Filme cadastrado com sucesso!' }) // Resposta para o Frontend
    } catch (err) {
        res.status(500).json({ erro: err.message })
    }
})

// ---------------------------------------------------------------
// ROTA: GET /filmes?q=termo
// Frontend → Backend → Elasticsearch → Backend → Frontend
// Busca filmes por termo (título, gênero ou sinopse) ou retorna todos
// ---------------------------------------------------------------
app.get('/filmes', async (req, res) => {
    try {
        const { q } = req.query // Termo de busca vindo da URL (?q=...)

        // Se houver termo, usa multi_match (busca em múltiplos campos)
        // Se não houver termo, retorna todos os documentos (match_all)
        const query = q ? {
            multi_match: { query: q, fields: ['titulo', 'genero', 'sinopse'] }
        } : { match_all: {} }

        // Envia a query para o Elasticsearch e aguarda o resultado
        const resultado = await axios.post(`${BONSAI_URL}/filmes/_search`, { query })

        // Extrai apenas os dados relevantes dos hits do Elasticsearch
        // Inclui o _id para permitir edição e exclusão no Frontend
        const filmes = resultado.data.hits.hits.map(h => ({ _id: h._id, ...h._source }))

        res.json(filmes) // Retorna a lista de filmes para o Frontend
    } catch (err) {
        res.status(500).json({ erro: err.message })
    }
})

// ---------------------------------------------------------------
// ROTA: PUT /filmes/:id
// Frontend → Backend → Elasticsearch
// Atualiza um documento existente pelo seu _id
// ---------------------------------------------------------------
app.put('/filmes/:id', async (req, res) => {
    try {
        const { titulo, genero, sinopse, ano } = req.body // Novos dados vindos do Frontend
        const { id } = req.params // ID do documento a ser atualizado

        // Substitui o documento inteiro no Elasticsearch pelo novo conteúdo
        await axios.put(`${BONSAI_URL}/filmes/_doc/${id}`, { titulo, genero, sinopse, ano })

        res.json({ mensagem: 'Filme atualizado com sucesso!' })
    } catch (err) {
        res.status(500).json({ erro: err.message })
    }
})

// ---------------------------------------------------------------
// ROTA: DELETE /filmes/:id
// Frontend → Backend → Elasticsearch
// Remove um documento do índice pelo seu _id
// ---------------------------------------------------------------
app.delete('/filmes/:id', async (req, res) => {
    try {
        const { id } = req.params // ID do documento a ser removido

        // Deleta o documento específico no Elasticsearch
        await axios.delete(`${BONSAI_URL}/filmes/_doc/${id}`)

        res.json({ mensagem: 'Filme deletado com sucesso!' })
    } catch (err) {
        res.status(500).json({ erro: err.message })
    }
})

// ---------------------------------------------------------------
// INICIALIZAÇÃO DO SERVIDOR
// Usa process.env.PORT para funcionar no Render (deploy)
// ou porta 3000 como fallback local
// ---------------------------------------------------------------
app.listen(process.env.PORT || 3000, () => console.log('Servidor rodando!'))