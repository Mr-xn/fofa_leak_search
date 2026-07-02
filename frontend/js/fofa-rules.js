// js/fofa-rules.js - FOFA 内置查询规则库（来源: fofax）

/**
 * 每条规则:
 * { name: string, query: string, description: string, tags: string[] }
 */
export const FOFA_RULES = [
    // ====== 未授权访问 ======
    { name: 'Jenkins 未授权', query: `app="JENKINS" && title=="Dashboard [Jenkins]"`, description: 'Jenkins 未授权访问 Dashboard', tags: ['jenkins', 'unauth'] },
    { name: 'Jupyter 未授权', query: `(body="ipython-main-app" && title="Home Page - Select or create a notebook")`, description: 'Jupyter Notebook 未授权访问', tags: ['jupyter', 'unauth'] },
    { name: 'Redis 未授权', query: `protocol="redis" && banner!="NOAUTH Authentication required."`, description: 'Redis 未授权访问（无密码认证）', tags: ['redis', 'unauth'] },
    { name: 'MongoDB', query: `protocol="MongoDB"`, description: 'MongoDB 数据库服务', tags: ['mongodb', 'db', 'unauth'] },
    { name: 'memcached', query: `app="MEMCACHED"`, description: 'Memcached 缓存服务', tags: ['memcached', 'unauth'] },
    { name: 'VNC', query: `app="VNC"`, description: 'VNC 远程桌面服务', tags: ['vnc', 'unauth'] },
    { name: 'docker', query: `protocol=="docker"`, description: 'Docker 容器服务', tags: ['docker', 'unauth'] },
    { name: 'kubernetes', query: `app="kubernetes"`, description: 'Kubernetes 容器编排', tags: ['kubernetes', 'unauth'] },
    { name: 'ZooKeeper', query: `app="APACHE-ZooKeeper"`, description: 'Apache ZooKeeper 服务', tags: ['zookeeper', 'unauth'] },
    { name: 'Kibana', query: `app="Kibana"`, description: 'Kibana 数据可视化', tags: ['kibana', 'unauth'] },
    { name: 'CouchDB', query: `app="APACHE-CouchDB"`, description: 'Apache CouchDB 数据库', tags: ['couchdb', 'db', 'unauth'] },
    { name: 'rsync', query: `app="rsync"`, description: 'rsync 文件同步服务', tags: ['rsync', 'unauth'] },
    { name: 'nfs', query: `"nfs" && port="2049"`, description: 'NFS 网络文件系统', tags: ['nfs', 'unauth'] },
    { name: 'ftp', query: `protocol="ftp"`, description: 'FTP 文件传输服务', tags: ['ftp', 'unauth'] },
    { name: 'ldap', query: `protocol="ldap"`, description: 'LDAP 目录服务', tags: ['ldap', 'unauth'] },

    // ====== 应用服务器 ======
    { name: 'JBOSS 未授权', query: `body="JBoss Management"`, description: 'JBoss 管理控制台未授权', tags: ['jboss', 'unauth'] },
    { name: 'WebLogic 未授权', query: `app="BEA-WebLogic-Server" || app="Weblogic_interface_7001"`, description: 'WebLogic 未授权访问', tags: ['weblogic', 'unauth'] },
    { name: 'APISIX Dashboard', query: `title="Apache APISIX Dashboard"`, description: 'Apache APISIX 仪表板', tags: ['apisix', 'unauth'] },
    { name: 'Alibaba Nacos', query: `title="Nacos"`, description: '阿里巴巴 Nacos 服务发现', tags: ['nacos', 'unauth'] },
    { name: 'Spark', query: `app="Spark"`, description: 'Apache Spark 计算引擎', tags: ['spark', 'unauth'] },
    { name: 'Zabbix 监控', query: `app="ZABBIX-监控系统"`, description: 'Zabbix 监控系统', tags: ['zabbix', 'unauth'] },
    { name: 'Atlassian Crowd', query: `app="Atlassian-Crowd-Login"`, description: 'Atlassian Crowd 单点登录', tags: ['crowd', 'unauth'] },
    { name: '阿里 Dubbo', query: `app="阿里巴巴-dubbo"`, description: 'Dubbo 服务框架', tags: ['dubbo', 'unauth'] },

    // ====== 大数据平台 ======
    { name: 'Hadoop YARN', query: `app="APACHE-hadoop-YARN"`, description: 'Hadoop YARN 资源管理', tags: ['hadoop', 'unauth'] },
    { name: 'Hadoop Hue', query: `app="CLOUDERA-Hadoop-Hue"`, description: 'Cloudera Hadoop Hue 组件', tags: ['hadoop', 'log4j2'] },
    { name: 'Hadoop HttpFS', query: `app="APACHE-hadoop-HttpFS"`, description: 'Hadoop HttpFS 组件', tags: ['hadoop', 'log4j2'] },
    { name: 'MapReduce', query: `app="Map/Reduce"`, description: 'Hadoop MapReduce 组件', tags: ['hadoop', 'log4j2'] },
    { name: 'Solr', query: `app="APACHE-Solr"`, description: 'Apache Solr 搜索引擎', tags: ['solr', 'unauth', 'log4j2'] },

    // ====== Log4j2 相关 ======
    { name: 'ActiveMQ', query: `app="APACHE-ActiveMQ"`, description: 'Apache ActiveMQ 消息中间件', tags: ['activemq', 'log4j2', 'unauth'] },
    { name: 'Apache OFBiz', query: `app="Apache_OFBiz"`, description: 'Apache OFBiz ERP 系统', tags: ['ofbiz', 'log4j2'] },
    { name: 'Jenkins', query: `app="Jenkins"`, description: 'Jenkins CI/CD 持续集成', tags: ['jenkins', 'log4j2'] },
    { name: 'RabbitMQ', query: `app="RabbitMQ"`, description: 'RabbitMQ 消息中间件', tags: ['rabbitmq', 'log4j2', 'unauth'] },
    { name: 'Jedis', query: `app="Jedis"`, description: 'Jedis Redis Java 客户端', tags: ['jedis', 'log4j2'] },
    { name: 'Apache Tika', query: `app="APACHE-tika"`, description: 'Apache Tika 内容分析框架', tags: ['tika', 'log4j2'] },
    { name: 'Skywalking', query: `app="APACHE-Skywalking"`, description: 'Apache SkyWalking APM 系统', tags: ['skywalking', 'log4j2'] },
    { name: 'Struts2', query: `app="Struts2"`, description: 'Apache Struts2 Web 框架', tags: ['struts2', 'log4j2'] },
    { name: 'Apache Shiro', query: `app="APACHE-Shiro"`, description: 'Apache Shiro 安全框架', tags: ['shiro', 'log4j2'] },
    { name: 'Dubbo', query: `app="APACHE-dubbo"`, description: 'Apache Dubbo 服务框架', tags: ['dubbo', 'log4j2'] },
    { name: 'SpringBoot', query: `app="vmware-SpringBoot-Framework"`, description: 'Spring Boot 应用框架', tags: ['springboot', 'log4j2'] },
    { name: 'MyBatis', query: `app="MyBatis"`, description: 'MyBatis Java 持久层框架', tags: ['mybatis', 'log4j2'] },
    { name: 'JEECMS', query: `app="JEECMS"`, description: 'JEECMS 内容管理系统', tags: ['jeecms', 'log4j2'] },
    { name: 'JeeSite', query: `app="JeeSite"`, description: 'JeeSite 快速开发平台', tags: ['jeesite', 'log4j2'] },
    { name: 'JEECG', query: `app="JEECG"`, description: 'JeecgBoot 低代码平台', tags: ['jeecg', 'log4j2'] },
    { name: 'OpenCms', query: `app="OPENCms"`, description: 'OpenCms 内容管理系统', tags: ['opencms', 'log4j2'] },

    // ====== 国内 OA/ERP ======
    { name: '致远互联 OA', query: `app="致远互联-OA"`, description: '致远互联办公自动化系统', tags: ['zhiyuan', 'oa', 'log4j2'] },
    { name: '致远互联 FE', query: `app="致远互联-FE"`, description: '致远互联 FE 办公平台', tags: ['zhiyuan', 'log4j2'] },
    { name: '致远A6', query: `app="致远A6"`, description: '用友致远 A6 协同管理', tags: ['zhiyuan', 'log4j2'] },
    { name: '致远A8', query: `app="致远A8"`, description: '致远 A8 协同管理软件', tags: ['zhiyuan', 'log4j2'] },
    { name: '泛微 协同OA', query: `app="泛微-协同办公OA"`, description: '泛微 e-cology 协同办公', tags: ['weaver', 'oa', 'log4j2'] },
    { name: '泛微 E-Weaver', query: `app="泛微-E-Weaver"`, description: '泛微 E-Weaver 管理平台', tags: ['weaver', 'log4j2'] },
    { name: '泛微 EMobile', query: `app="泛微-EMobile"`, description: '泛微 e-mobile 移动办公', tags: ['weaver', 'log4j2'] },
    { name: '用友 ERP NC', query: `app="用友-ERP-NC"`, description: '用友 NC 企业 ERP', tags: ['yonyou', 'erp', 'log4j2'] },
    { name: '用友 GRP U8', query: `app="用友-GRP-U8"`, description: '用友 GRP-U8 内控管理', tags: ['yonyou', 'log4j2'] },
    { name: '用友 UFIDA NC', query: `app="用友-UFIDA-NC"`, description: '用友 UFIDA NC 管理方案', tags: ['yonyou', 'log4j2'] },
    { name: 'jeewms', query: `app="jeewms"`, description: 'jeewms 仓库管理系统', tags: ['wms', 'log4j2'] },
    { name: 'Jeeplus', query: `app="Jeeplus"`, description: 'Jeeplus 快速开发框架', tags: ['jeeplus', 'log4j2'] },

    // ====== 其他服务 ======
    { name: 'SQL Server', query: `app="Microsoft-SQL-Server"`, description: 'Microsoft SQL Server 数据库', tags: ['sqlserver', 'db', 'unauth'] },
    { name: 'MySQL', query: `app="mysql"`, description: 'MySQL 数据库服务', tags: ['mysql', 'db', 'unauth'] },
    { name: 'Oracle EBS', query: `app="Oracle-E-Business-Suite"`, description: 'Oracle E-Business Suite', tags: ['oracle', 'erp', 'log4j2'] },
    { name: 'Splunk', query: `app="splunk-日志分析"`, description: 'Splunk 日志分析平台', tags: ['splunk', 'log4j2'] },
    { name: 'VMware vCenter', query: `app="vmware-vCenter"`, description: 'VMware vCenter Server', tags: ['vmware', 'log4j2'] },
    { name: 'Cortex XSOAR', query: `app="Cortex-XSOAR"`, description: 'Cortex XSOAR 安全编排', tags: ['xsoar', 'unauth'] },

    // ====== 有趣发现 ======
    { name: 'Google 反代', query: `body="var c = Array.prototype.slice.call(arguments, 1);return function() {var d=c.slice();"`, description: 'Google 搜索反向代理服务器', tags: ['google', 'fun'] },
    { name: 'Python SimpleHTTP', query: `server="SimpleHTTP" && title="Directory listing "`, description: 'Python SimpleHTTP 临时服务器', tags: ['python', 'fun'] },
    { name: '社工库', query: `title="社工库" || ((title="社工库" && title="系统") || (title="社工库查询" ))`, description: '社工库查询系统', tags: ['fun'] },
    { name: 'HFS 命令执行', query: `body="HttpFileServer v2.3 beta 287"`, description: '存在命令执行的 HFS 服务', tags: ['hfs', 'fun'] },
    { name: '卫星 FTP', query: `banner="Cobham SATCOM"`, description: 'Cobham 卫星通信 FTP', tags: ['satellite', 'fun'] },
    { name: 'MK 挖矿', query: `app="Mikrotik-HttpProxy"&&(body="CoinHive.Anonymous" || body="CRLT.Anonymous" || body=" WMP.Anonymous(")`, description: 'MikroTik 路由器挖矿感染', tags: ['mikrotik', 'fun'] },
    { name: 'ss-Manager', query: `body="indeterminate" && body="MainController" && header="X-Powered-By: Express"`, description: 'Shadowsocks-Manager 面板', tags: ['ss', 'fun'] },
    { name: '供暖监控', query: `body="s1v13.htm"`, description: '供暖监控系统', tags: ['fun'] },
    { name: '免费代理池', query: `body="get all proxy from proxy pool"`, description: '免费代理池获取', tags: ['proxy', 'fun'] },
    { name: '蜜罐', query: `(header="uc-httpd 1.0.0" && server="JBoss-5.0") || server="Apache,Tomcat,Jboss,weblogic,phpstudy,struts"`, description: '蜜罐系统', tags: ['honeypot', 'fun'] },
    { name: '被挂黑站点', query: `body="hacked by"`, description: '被黑客挂黑页的站点', tags: ['hacked', 'fun'] },
    { name: 'Flash 钓鱼', query: `icon_hash="1506728116" || body="ade42d4f682c4fca28c5f093052433c1"`, description: 'Flash 钓鱼攻击页面', tags: ['flash', 'phish', 'fun'] },
];
