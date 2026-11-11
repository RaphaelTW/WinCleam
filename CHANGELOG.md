# Changelog

Todas as alterações relevantes deste projeto são registradas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o versionamento segue [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [2.0.10] - 2026-11-10

### Alterado

- Interface compactada, com painel de temperaturas e log recolhíveis.
- Tema simplificado para Automático, Claro e Escuro.
- Navegação reorganizada, incluindo a área unificada de Ferramentas e atualizações.
- Configurações centralizam idioma, tema, executáveis externos e status do Libre Hardware Monitor.
- Catálogo de tarefas movido para `shared/tasks.json`, compartilhado entre React e Rust.
- Lógica Rust movida para biblioteca, permitindo testes sem UAC.

### Adicionado

- Bandeja do sistema: fechar a janela mantém o WinCleam disponível em segundo plano.
- Ação de limpeza de memória em espera pelo menu da bandeja, quando RAMMap estiver configurado.
- Verificação de updates por GitHub Releases, com abertura da release oficial para atualização manual.
- Telemetria opcional de CPU, GPU, placa-mãe e memória RAM por Libre Hardware Monitor/WMI.
- Status, instruções de WMI e link oficial do Libre Hardware Monitor em Configurações.
- Barra fixa para executar tarefas selecionadas durante a rolagem.
- Exibição resumida de logs técnicos, com opção de consultar a saída bruta e preservar o conteúdo exportado.
- Testes Rust para temperaturas, resumo de logs, validação de discos, tarefas e limpeza segura.

### Corrigido

- Legenda de CPU, memória e progresso posicionada fora dos anéis de atividade.
- Duplicação do acesso a Configurações removida.
- Identificação e autoria exibidas como Raphael Laurentino.

## [2.0.0] - 2026-11-10

### Adicionado

- Aplicativo desktop Windows construído com Tauri 2, Rust e React.
- Instalador NSIS por máquina, com UAC e suporte a Português (Brasil), inglês britânico, espanhol, russo e chinês simplificado.
- Monitoramento de CPU e memória RAM em tempo real.
- Fila sequencial de tarefas, progresso determinado/indeterminado, logs locais e exportação de logs.
- Operações para DISM, SFC, limpeza de componentes, Limpeza de Disco, CHKDSK, otimização de armazenamento, DNS, DHCP e WinGet.
- Limpeza restrita de temporários, miniaturas e caches de navegadores, com proteção contra links, junções e processos de navegador em execução.
- Detecção e validação de unidades fixas antes de operações CHKDSK.
- Integração opcional com RAMMap e Process Lasso por executáveis selecionados pelo usuário.
- Ícone do aplicativo, favicon e instalador com a identidade visual do WinCleam.
- Verificação de releases estáveis no GitHub e atalho seguro para a página oficial de atualização.
- Bandeja do sistema para manter o aplicativo disponível após fechar a janela.

### Segurança

- Lista permitida de operações no backend Rust; a interface não pode montar comandos arbitrários.
- Validação de privilégios administrativos, IDs de tarefa, unidades e confirmação adicional para `chkdsk /f`.
- Processos nativos sem janela de console e CSP restritiva no WebView.

### Documentação

- README com pré-requisitos, fluxo da aplicação, build, distribuição, segurança e solução para PATH do Rust.
- Termos de instalação em UTF-8 nos cinco idiomas suportados.

[2.0.10]: https://github.com/RaphaelTW/WinCleam/compare/v2.0.0...v2.0.10
[2.0.0]: https://github.com/RaphaelTW/WinCleam/releases/tag/v2.0.0
