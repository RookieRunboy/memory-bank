# 人生访谈问题库 v4

更新于 2026-11-08。与 app/src/framework.json 同步，含 52 个话题、289 条问法。

## 研究依据与适用范围

本次调研由独立研究 subagent 完成，主 agent 复核来源后落地。采用七份机构的一手公开访谈指南和沟通建议，检索日期为 2026-11-08。来源支撑主题和方法，中文问题、适用前提和低负担问法由本项目自主编写。它们尚未经长者用户研究或临床验证。

通用口述史重视具体经历、清楚的起问和顺着回答展开。提纲用于帮助主持人找到值得继续讲的细节，允许受访者改变方向。[Smithsonian · The Interview](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/the-interview/smithsonian)、[Oral History Association · Oral History Best Practices](https://oralhistory.org/best-practices/)。

面对认知沟通困难，问题需要进一步缩小范围，减少一次要处理的信息，给回应时间。照片、物件可以提供话头，但要确实存在或由本人提起。高龄本身不作为采用低负担问法的判断条件。[Alzheimer’s Society · How to communicate with a person with dementia](https://www.alzheimers.org.uk/about-dementia/stages-and-symptoms/dementia-symptoms/how-to-communicate-dementia)。

主题检查参考了家庭传统、社区与手艺，自传中的关系与个人愿望，重要选择，以及普通日常、收支、退休和技术变化。[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)、[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)、[Abraham Lincoln Presidential Library and Museum · Interview Outline — Family Memories](https://presidentlincoln.illinois.gov/research/research-divisions/oral-history/volunteer-resources/interview-outline-family-memories/)、[UNC Southern Oral History Program · Life History Interviews: Sample Questions](https://sohp.org/wp-content/uploads/2022/12/Life-History-Questions.pdf)。

| 来源 ID | 来源与核查位置 | 支持的内容 |
|---|---|---|
| `smithsonian-questions` | [Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian) | 家族来历、姓名、习俗、社区、物件与手艺主题。参见 Family Folklore、Local History and Community Life、Cultural Traditions/Occupational Skills。 |
| `smithsonian-interview` | [Smithsonian · The Interview](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/the-interview/smithsonian) | 简洁起问、具体故事、跟随回答追问、留出思考时间。 |
| `oha-practices` | [Oral History Association · Oral History Best Practices](https://oralhistory.org/best-practices/) | 开放提纲、澄清与反思、受访者自主选择主题及拒绝讨论的权利。 |
| `storycorps-questions` | [StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/) | 成长、关系、学习、工作、个人信念与未来愿望等主题。 |
| `alplm-family` | [Abraham Lincoln Presidential Library and Museum · Interview Outline — Family Memories](https://presidentlincoln.illinois.gov/research/research-divisions/oral-history/volunteer-resources/interview-outline-family-memories/) | 生涯选择、家庭生活、重要决定、观点变化和回顾。 |
| `unc-life-history` | [UNC Southern Oral History Program · Life History Interviews: Sample Questions](https://sohp.org/wp-content/uploads/2022/12/Life-History-Questions.pdf) | 家庭日常与分工、收支、技术变化、退休和社区生活。重点参见 PDF 第3、4、6、8页。 |
| `alzheimers-communication` | [Alzheimer’s Society · How to communicate with a person with dementia](https://www.alzheimers.org.uk/about-dementia/stages-and-symptoms/dementia-symptoms/how-to-communicate-dementia) | 认知沟通困难时简短表达、减少复杂提问、熟悉物件提示、给回应时间。按个人状态适配。 |

## 本项目的编辑与适配

以下规则是综合来源后的产品设计判断。源文献中的问题不能直接等同于适合每位老人的问法。

- 每次问一个具体问题，允许只讲一件小事。跟进当时的行动、对话、选择和变化。
- 依据本人讲过的事实使用关系称谓。上学、婚育、孙辈、退休等话题先有相应前提。
- 感受由本人表达。去掉预设新衣、被夸、幸福、成功的题目，意义也可以是本人如今的理解。
- 第四类问题扩为“意义与寄语”，愿意时再问，不要求每段故事落到子孙身上。
- 回答困难时使用低负担问法。它仍需贴合已知场景，可以答“没有”“不知道”，不用猜测补齐答案。
- 创伤、失去亲人、家庭矛盾只跟随本人意愿，不主动追问最痛苦的细节，也不强行转换为励志故事。
- 收尾前可以留出自己想补充的故事和往后心愿。本人想停时立即结束。
- source_refs 指向题组的主题来源，research.method_source_refs 指向全库的方法依据。具体中文问题均属于项目编辑。

## 运行方式与兼容

原有 42 个话题 ID 保留，新增 10 个话题。旧档案中的 depth、notes、entities 和 status=done 仍按现有读取规则使用。数字 depth 1–4 沿用事实、场景细节、感受、意义与寄语，旧寄语属于第四类。

在线访谈每轮只注入当前题组的四个方向、低负担问法、适用前提和敏感提示。模型跟随当前回答挑问法，来源链接留在本文件和 JSON 中。entry_condition 是供模型使用的前提说明，现有选题算法还会过滤敏感标记、需要平静的话题，以及缺少伴侣或子女档案的相关话题。

离线兜底仍按原有数字层次选题。它使用新版问题文本，灵活跟随回答的能力由在线模型提供。达到第四类会影响后续选题的 enough 状态，在线对话仍可继续听本人讲述。

当前保留的运行参数包括连续三次简短回答、单节点八轮和在线单场十轮。这些是项目参数，来源未给出这些固定阈值。

新增话题覆盖名字、家史、普通一天、重要决定、家庭开销、社区、信念、退休、技术变化、自主补充。选择、开销、信念默认要求本人主动选择，轻松开场继续由吃食、歌戏和节日提供。

## 话题与问法

四类问法提供可选方向。下文的个人体验对应 depth 3，意义与寄语对应 depth 4。所有追问均以此前已讲到相关人、事为前提。

### 老家的房子（child-home）

使用前提　老人主动选择老家或提到童年住处，不要求精确地址。

- 起问　小时候，您家门口是什么样的？
- 场景追问　从门口进去，先看见什么？
- 个人体验　在那个家里，您喜欢待在哪儿？
- 意义与寄语　那个家的哪处地方，您最想留下来？
- 低负担问法　家门口有院子吗？
- 老照片提示　照片里，哪处地方您想说说？

使用提醒　涉及生活困难时，跟随本人愿意讲的日常，不预设受苦或强行赞扬。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 妈妈（child-mother）

使用前提　本人提起妈妈或愿意谈母亲，不预设共同生活或关系亲密。

- 起问　想起妈妈，您先想到哪件小事？
- 场景追问　那次她对您说了什么？
- 个人体验　那句话当时对您有什么影响？
- 意义与寄语　如今，您怎样理解她那句话？
- 低负担问法　妈妈平时忙家里多吗？
- 家乡菜提示　说到妈妈，您想到哪样吃食？

使用提醒　可能涉及已故或疏远的人。允许本人表达复杂感受，不追问离世过程，不强迫积极回忆。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 和父亲学本事（child-father-bike）

使用前提　本人愿意谈父亲和学本事；骑车只在本人提到时追问。

- 起问　父亲教过您做什么？
- 场景追问　刚学的时候，您先做了哪一步？
- 个人体验　哪一步让您费了些心思？
- 意义与寄语　后来，您还用过这个办法吗？
- 低负担问法　那时您常跟父亲一起干活吗？
- 老物件提示　这件东西，您想起父亲怎样用它？

使用提醒　可能涉及已故或疏远的人。允许本人表达复杂感受，不追问离世过程，不强迫积极回忆。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 兄弟姐妹（child-siblings）

使用前提　已知有兄弟姐妹且愿意聊；意见不同时的追问只用于已提及的分歧。

- 起问　小时候，您常和哪位兄弟姐妹作伴？
- 场景追问　你们一起做过什么事？
- 个人体验　意见不同时，您会怎么说？
- 意义与寄语　现在，您怎样看那时的相处？
- 低负担问法　你们那时住在一起吗？
- 老照片提示　照片里，您想先聊哪位亲人？

使用提醒　可能涉及已故或疏远的人。允许本人表达复杂感受，不追问离世过程，不强迫积极回忆。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 玩伴与游戏（child-play）

使用前提　本人选择玩伴或游戏，不预设童年快乐。

- 起问　小时候，您常和伙伴玩什么？
- 场景追问　轮到您时，要怎么做？
- 个人体验　您喜欢这个游戏的哪一点？
- 意义与寄语　现在还有人玩这个游戏吗？
- 低负担问法　那个游戏在屋外玩吗？
- 老物件提示　这个玩意儿，当时怎么玩？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 小时候过年（child-newyear）

使用前提　本人选择过年，不预设新衣、丰盛饭菜或家人团聚。

- 起问　小时候过年，家里先忙什么？
- 场景追问　那件事通常由谁来做？
- 个人体验　过年时，您盼着什么？
- 意义与寄语　哪样过年习惯，您后来还留着？
- 低负担问法　过年家里会做特别的吃食吗？
- 节日提示　说到过年，您想先讲哪件事？

使用提醒　涉及生活困难时，跟随本人愿意讲的日常，不预设受苦或强行赞扬。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 小时候的吃食（child-food）

使用前提　本人愿意聊食物，不预设由母亲制作；现在再吃仅在提到吃过时问。

- 起问　小时候，哪样吃的让您记得清楚？
- 场景追问　那样吃的，通常从哪儿来？
- 个人体验　您喜欢它的什么味道？
- 意义与寄语　现在再吃它，有什么不同？
- 低负担问法　那样吃的是甜的吗？
- 家乡菜提示　这个味道，让您想起哪样吃的？

使用提醒　涉及生活困难时，跟随本人愿意讲的日常，不预设受苦或强行赞扬。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 家乡的河与树（child-river）

使用前提　本人讲到熟悉地点，不预设有河、大树或仍能回去。

- 起问　老家附近，您常去哪个地方？
- 场景追问　去那儿要经过什么？
- 个人体验　到了那里，您喜欢做什么？
- 意义与寄语　那地方后来有过什么变化？
- 低负担问法　那个地方离家近吗？
- 老歌提示　这首歌，让您想起家乡哪里？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 上学（teen-school）

使用前提　本人提到上学经历；没有上学经历时不追问原因，跟随其他学习经历。

- 起问　您想讲讲哪段上学的事？
- 场景追问　那间教室里，您坐在哪儿？
- 个人体验　那时候，您对什么课感兴趣？
- 意义与寄语　在学校学到的，后来用上过什么？
- 低负担问法　上学的地方离家近吗？
- 老照片提示　这张照片，让您想起哪段上学的事？

使用提醒　没有上学经历时，可听本人讲其他学习经历，不考试、不追问失学原因。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 难忘的老师（teen-teacher）

使用前提　已知上学或学习经历，不预设老师曾夸奖或善待本人。

- 起问　哪位老师让您一直记着？
- 场景追问　他做过什么让您记住的事？
- 个人体验　那件事当时怎样影响了您？
- 意义与寄语　后来，您对那件事有过新想法吗？
- 低负担问法　这位老师教过您吗？

使用提醒　只听本人主动愿意展开的时代经历。出现不适时暂停，不点名引导创伤事件。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 帮家里干活（teen-chores）

使用前提　本人提到帮忙或劳动，不预设吃苦必有收获。

- 起问　小时候，您常帮着做什么活？
- 场景追问　做这件活，要先准备什么？
- 个人体验　哪一步最需要您留神？
- 意义与寄语　这个经验，后来还用得上吗？
- 低负担问法　那件活是在屋外做的吗？
- 老物件提示　这个工具，当时怎么用？

使用提醒　涉及生活困难时，跟随本人愿意讲的日常，不预设受苦或强行赞扬。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 少年时的好朋友（teen-friend）

使用前提　本人提到朋友或主动选择，不预设仍保持联系。

- 起问　那时候，您常和哪个朋友作伴？
- 场景追问　你们见面后，通常先做什么？
- 个人体验　有什么事，您愿意跟他商量？
- 意义与寄语　现在，您怎样看这段交情？
- 低负担问法　那位朋友住得近吗？

使用提醒　可能涉及已故或疏远的人。允许本人表达复杂感受，不追问离世过程，不强迫积极回忆。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 少年时唱的歌（teen-song）

使用前提　本人主动提起歌曲，广播只作可否认的低负担提示。

- 起问　年轻时，您常听到什么歌？
- 场景追问　一般在哪儿能听见它？
- 个人体验　听到它，您会想起哪件事？
- 意义与寄语　这首歌对您的意义变过吗？
- 低负担问法　那首歌是从广播里听来的吗？
- 老歌提示　这首歌，您通常在哪儿听？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 少年时的大事（teen-times）

使用前提　只接本人主动提到且愿意展开的事件，分清亲历和转述。

- 起问　您刚说的那件大事，怎么发生的？
- 场景追问　这件事，您当时是怎么知道的？
- 个人体验　那之后，您每天的生活有什么变化？
- 意义与寄语　那段经历，您想留下哪一部分？
- 低负担问法　那时您是在家乡吗？

使用提醒　只听本人主动愿意展开的时代经历。出现不适时暂停，不点名引导创伤事件。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 少年时的心愿（teen-dream）

使用前提　本人愿意谈心愿，不预设实现或失败。

- 起问　年轻时，您想做什么事情？
- 场景追问　您是从什么时候动这个念头的？
- 个人体验　为了这件事，您试过什么？
- 意义与寄语　现在，您还想做些什么？
- 低负担问法　这个念头跟工作有关吗？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 第一份工作（youth-firstjob）

使用前提　已知有工作经历，包括务农、学徒、自营，不预设工厂或工资形式。

- 起问　您怎么找到第一份工作的？
- 场景追问　头一天去，您先做了什么？
- 个人体验　刚开始，哪件事让您最费心？
- 意义与寄语　这份工作给后来留下了什么？
- 低负担问法　那份工作离家远吗？
- 老物件提示　这件东西在那份活里怎么用？

使用提醒　包括正式与非正式劳动，不预设体面职业；失业、工伤等只听本人愿意说的部分。

主题依据　[Abraham Lincoln Presidential Library and Museum · Interview Outline — Family Memories](https://presidentlincoln.illinois.gov/research/research-divisions/oral-history/volunteer-resources/interview-outline-family-memories/)。

### 带我入门的师傅（youth-master）

使用前提　本人提到带路人；带新人只在确有相关经历时问。

- 起问　刚做这行时，谁带过您？
- 场景追问　他当时是怎么教您的？
- 个人体验　哪句话让您一直记着？
- 意义与寄语　后来带新人时，您会怎么教？
- 低负担问法　他会在旁边看您做吗？

使用提醒　可能涉及已故或疏远的人。允许本人表达复杂感受，不追问离世过程，不强迫积极回忆。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 和{重要人物}相识（youth-meet）

使用前提　本人选择伴侣话题或已讲到相识，不预设恋爱方式或婚姻幸福。

- 起问　您和{重要人物}是怎么认识的？
- 场景追问　头一回见面，谁先开的口？
- 个人体验　后来，您怎么决定继续来往的？
- 意义与寄语　现在看，那次相识带来了什么？
- 低负担问法　初次见面是在熟人家吗？
- 老照片提示　照片里，您想先讲哪段相识的事？

使用提醒　关系可能复杂。使用本人称呼，尊重不愿谈的部分，不把婚姻写成幸福模板。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 谈对象的日子（youth-date）

使用前提　已提到交往经历，不预设看电影、骑车等情节。

- 起问　那时见面，你们常去哪里？
- 场景追问　那次见面，你们做了什么？
- 个人体验　对方哪件小事让您记住了？
- 意义与寄语　现在想起，哪一刻您还想讲讲？
- 低负担问法　那地方走路就能到吗？
- 老歌提示　这首歌，让您想到哪次见面？

使用提醒　关系可能复杂。使用本人称呼，尊重不愿谈的部分，不把婚姻写成幸福模板。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 结婚那天（youth-wedding）

使用前提　本人愿意讲婚礼或结婚经历，不预设仪式、酒席或喜悦。

- 起问　结婚那天，您先想到哪个场面？
- 场景追问　那个场面里，您在做什么？
- 个人体验　那天有什么事让您放在心上？
- 意义与寄语　那次经历，对您意味着什么？
- 低负担问法　那天身边有熟人吗？
- 老照片提示　这张照片里，您想先聊哪个场面？

使用提醒　关系可能复杂。使用本人称呼，尊重不愿谈的部分，不把婚姻写成幸福模板。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 刚成家住的地方（youth-newhome）

使用前提　本人已提到成家住处，不预设买房或添置大件。

- 起问　刚成家时，你们住在哪里？
- 场景追问　搬进去后，先安顿了什么？
- 个人体验　您当时最想把哪件事安排好？
- 意义与寄语　那个家，有什么让您一直记着？
- 低负担问法　那时住的地方宽敞吗？
- 老物件提示　这件东西，当时放在家里哪里？

使用提醒　涉及生活困难时，跟随本人愿意讲的日常，不预设受苦或强行赞扬。

主题依据　[UNC Southern Oral History Program · Life History Interviews: Sample Questions](https://sohp.org/wp-content/uploads/2022/12/Life-History-Questions.pdf)。

### 刚开始照顾孩子（youth-firstchild）

使用前提　本人愿意谈育儿；手忙脚乱只在本人提到困难时追问，不预设亲生或分娩经历。

- 起问　刚开始照顾孩子时，您先忙什么？
- 场景追问　有一次手忙脚乱，是怎么回事？
- 个人体验　那时候，什么支持对您有帮助？
- 意义与寄语　这段经历改变了您的什么想法？
- 低负担问法　当时有人搭把手吗？

使用提醒　不预设生育经历、孩子健在或亲子亲密，不比较孩子。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 年轻时的工友（youth-coworkers）

使用前提　本人讲到同事或合作伙伴，不预设关系和睦。

- 起问　一起干活的人里，您想先聊谁？
- 场景追问　你们一起做过哪件事？
- 个人体验　那件事上，您怎样和他配合？
- 意义与寄语　后来，您从这段共事里带走什么？
- 低负担问法　你们平时在同一处干活吗？
- 老照片提示　照片里的同伴，您想先说谁？

使用提醒　可能涉及已故或疏远的人。允许本人表达复杂感受，不追问离世过程，不强迫积极回忆。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 年轻时得意的事（youth-pride）

使用前提　本人愿意聊成就，允许普通小事，不要求奖项或最高成就。

- 起问　有什么事，您做完觉得挺满意？
- 场景追问　当时您是怎么把它做成的？
- 个人体验　做到哪一步，您觉得有把握了？
- 意义与寄语　这件事，您看重的是什么？
- 低负担问法　那件事是您自己动手做的吗？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[Abraham Lincoln Presidential Library and Museum · Interview Outline — Family Memories](https://presidentlincoln.illinois.gov/research/research-divisions/oral-history/volunteer-resources/interview-outline-family-memories/)。

### 青年时的大事（youth-times）

使用前提　只聊本人主动提到的社会事件，不引入未提及的灾难或政治运动。

- 起问　您说的那次变化，从哪里开始？
- 场景追问　那天您在什么地方？
- 个人体验　它怎样影响了您的打算？
- 意义与寄语　现在，您怎样理解那次变化？
- 低负担问法　那时身边有人陪着您吗？

使用提醒　只听本人主动愿意展开的时代经历。出现不适时暂停，不点名引导创伤事件。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 把孩子拉扯大（midlife-kids）

使用前提　已提到照顾孩子，不预设性别分工、血缘或家庭和睦。

- 起问　照顾孩子那几年，您每天忙什么？
- 场景追问　挑一天说说，早上先做什么？
- 个人体验　哪件小事让您觉得值得？
- 意义与寄语　后来，您对照顾孩子有什么新想法？
- 低负担问法　那时常要给孩子做饭吗？
- 家乡菜提示　这道吃的，让您想起孩子的哪件事？

使用提醒　不预设生育经历、孩子健在或亲子亲密，不比较孩子。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 孩子小时候的小事（midlife-naughty）

使用前提　本人愿意讲孩子的具体故事，不先贴调皮或闯祸标签。

- 起问　孩子小时候，有哪件小事让您记着？
- 场景追问　那次您是怎么回应他的？
- 个人体验　您当时在意的是什么？
- 意义与寄语　今天再看，您会怎样理解那件事？
- 低负担问法　那件事是在家里发生的吗？

使用提醒　不预设生育经历、孩子健在或亲子亲密，不比较孩子。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 工作上的那些年（midlife-work）

使用前提　已知本人工作经历；使用本人说的工作名称，不预设加班或艰苦。

- 起问　那时候上工，您先做什么？
- 场景追问　哪一步最要紧？
- 个人体验　做这份活，您最看重什么？
- 意义与寄语　这行后来有哪些变化？
- 低负担问法　干活时要用工具吗？
- 老物件提示　干那份活时，这个工具怎么用？

使用提醒　包括正式与非正式劳动，不预设体面职业；失业、工伤等只听本人愿意说的部分。

主题依据　[UNC Southern Oral History Program · Life History Interviews: Sample Questions](https://sohp.org/wp-content/uploads/2022/12/Life-History-Questions.pdf)。

### 拿手的手艺（midlife-craft）

使用前提　本人认可的本事都可以，反思传承由本人选择，不假定有子女接手。

- 起问　您想讲讲哪样拿手的本事？
- 场景追问　做它的第一步是什么？
- 个人体验　做到什么样，您自己才满意？
- 意义与寄语　您希望这门本事怎样传下去？
- 低负担问法　做这件活要用手工工具吗？
- 老物件提示　用这件工具，第一步做什么？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 成家后的兄弟姐妹（midlife-siblings）

使用前提　本人已讲到兄弟姐妹，不预设都成家、常团聚或关系亲近。

- 起问　后来，您和兄弟姐妹怎么来往？
- 场景追问　挑一次见面说说，做了什么？
- 个人体验　哪次相处让您有了新的感受？
- 意义与寄语　您希望这份联系往后怎样？
- 低负担问法　那时见一面方便吗？
- 节日提示　说到过节，您想讲哪次见面？

使用提醒　可能涉及已故或疏远的人。允许本人表达复杂感受，不追问离世过程，不强迫积极回忆。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 搬过的家（midlife-move）

使用前提　本人提到迁居；原因和损失只跟随其自愿讲述。

- 起问　搬过的地方里，您想先聊哪一处？
- 场景追问　刚搬进去，先安顿了什么？
- 个人体验　那次搬家，您最挂心什么？
- 意义与寄语　住在那里，改变了您的什么习惯？
- 低负担问法　搬过去时带了不少东西吗？
- 老照片提示　照片里的住处，您想先讲哪里？

使用提醒　涉及生活困难时，跟随本人愿意讲的日常，不预设受苦或强行赞扬。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 难走的日子（midlife-hard）

使用前提　只在本人主动提起且愿意继续时使用，不要求积极结局或追问创伤细节。

- 起问　您说那段日子难，想从哪件事讲起？
- 场景追问　那一天，您先做了什么？
- 个人体验　那时候，您最需要什么？
- 意义与寄语　这段经历，您愿意留下什么？
- 低负担问法　咱们先歇一会儿好吗？

使用提醒　只听本人主动愿意展开的时代经历。出现不适时暂停，不点名引导创伤事件。 关心当下是否愿意继续，不追问病情、伤痛细节或给医疗建议。

主题依据　[Abraham Lincoln Presidential Library and Museum · Interview Outline — Family Memories](https://presidentlincoln.illinois.gov/research/research-divisions/oral-history/volunteer-resources/interview-outline-family-memories/)。

### 出过的远门（midlife-travel）

使用前提　本人愿意谈出行，不要求最远、最好等排序。

- 起问　出过的远门里，您想先讲哪一次？
- 场景追问　刚到那里，您先看到了什么？
- 个人体验　哪件事跟您出发前想的不一样？
- 意义与寄语　回来以后，您有什么新想法？
- 低负担问法　那次是坐车去的吗？
- 老照片提示　这张照片，是在哪趟出门时拍的？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[Abraham Lincoln Presidential Library and Museum · Interview Outline — Family Memories](https://presidentlincoln.illinois.gov/research/research-divisions/oral-history/volunteer-resources/interview-outline-family-memories/)。

### 陪父母变老（midlife-parents-old）

使用前提　本人主动提到父母晚年或照料，不预设尽孝、亏欠或共同居住。

- 起问　那阵子，您常陪父母做什么？
- 场景追问　有哪次相处让您记得清楚？
- 个人体验　当时您有什么想说的话？
- 意义与寄语　如今，您怎样看那段相处？
- 低负担问法　那时见父母方便吗？

使用提醒　可能涉及已故或疏远的人。允许本人表达复杂感受，不追问离世过程，不强迫积极回忆。 关心当下是否愿意继续，不追问病情、伤痛细节或给医疗建议。

主题依据　[UNC Southern Oral History Program · Life History Interviews: Sample Questions](https://sohp.org/wp-content/uploads/2022/12/Life-History-Questions.pdf)。

### 孙辈（elder-grandkids）

使用前提　本人已提到孙辈且愿意聊，不用子女存在推定有孙辈。

- 起问　和孙辈在一起，您常做什么？
- 场景追问　有哪次相处让您想讲讲？
- 个人体验　那件事里，您最在意什么？
- 意义与寄语　有什么话，您愿意说给他们听？
- 低负担问法　您和他们常见面吗？
- 老照片提示　照片里的孩子，您想说哪件事？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 家乡的味道（elder-hometown-food）

使用前提　本人选食物话题；制作问题仅在本人知道做法时问。

- 起问　说起{家乡}的吃食，您先想到什么？
- 场景追问　做这道吃的，先准备什么？
- 个人体验　您喜欢它的什么味道？
- 意义与寄语　家里的做法，后来有什么变化？
- 低负担问法　这道吃的是热着吃的吗？
- 家乡菜提示　说到这道吃的，您想到哪件事？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 节日和习俗（elder-festivals）

使用前提　节日由本人选择，不预设宗教、地域习俗或共同庆祝。

- 起问　家里过什么节，您想讲讲？
- 场景追问　那天，您通常负责哪件事？
- 个人体验　您喜欢过节的哪个时刻？
- 意义与寄语　哪样习惯，您还想继续留着？
- 低负担问法　过那个节，会做特别的吃食吗？
- 节日提示　这个节日，家里有什么习惯？

使用提醒　由本人定义习俗及意义，不预设宗教与地域做法。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 喜欢的歌和戏（elder-songs）

使用前提　只用本人选择的歌戏，允许说几字或不唱，不考歌词。

- 起问　您想聊哪首歌或哪出戏？
- 场景追问　您通常在哪儿听它？
- 个人体验　它让您想起什么人或事？
- 意义与寄语　您愿意留下其中哪一句？
- 低负担问法　您喜欢听唱的那一段吗？
- 老歌提示　这首歌里，您喜欢哪一段？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 老朋友老邻居（elder-friends）

使用前提　本人愿意谈朋友；合得来只在本人表达亲近后问，不预设仍健在。

- 起问　老朋友里，您想先说说谁？
- 场景追问　你们见面通常做什么？
- 个人体验　哪次相处让您觉得合得来？
- 意义与寄语　这段交情，对您有什么意义？
- 低负担问法　那位朋友以前住得近吗？
- 老照片提示　照片中的朋友，您想先聊谁？

使用提醒　可能涉及已故或疏远的人。允许本人表达复杂感受，不追问离世过程，不强迫积极回忆。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 现在的爱好（elder-hobby）

使用前提　关注兴趣与本人意愿，不追考昨天或具体日期。

- 起问　闲下来，您喜欢做点什么？
- 场景追问　做这件事，您通常先准备什么？
- 个人体验　哪一部分最让您投入？
- 意义与寄语　往后，您还想尝试什么？
- 低负担问法　这件事在家就能做吗？

使用提醒　问熟悉的习惯与喜好，不考近期事件或精确日期。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 珍藏的老物件（elder-oldthing）

使用前提　本人主动提到物件，不预设送礼人、购买经历或身后分配。

- 起问　有什么东西，您一直舍不得丢？
- 场景追问　它是怎么到您手里的？
- 个人体验　哪段经历让它变得特别？
- 意义与寄语　您想为它留下怎样的说明？
- 低负担问法　它平时放在家里吗？
- 老物件提示　这件东西是怎么到您手里的？

使用提醒　可能涉及已故或疏远的人。允许本人表达复杂感受，不追问离世过程，不强迫积极回忆。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 想对家人说的话（elder-wishes）

使用前提　本人愿意表达寄语，不预设有子孙，不把谈话当作最后告别。

- 起问　有什么话，您想说给在意的人听？
- 场景追问　想到这句话，您会想起哪件事？
- 个人体验　这件事对您有什么意义？
- 意义与寄语　您愿意把这句话说给谁听？
- 低负担问法　这句话是想说给家里人的吗？

使用提醒　由本人选择说给谁听，不代答家人想法，不暗示最后告别或承诺分享。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 名字和称呼（life-name）

使用前提　本人愿意聊名字或称呼；只谈故事不自动修改当前称呼。

- 起问　以前家里都怎么叫您？
- 场景追问　这个叫法是怎么来的？
- 个人体验　您喜欢别人怎么叫您？
- 意义与寄语　这个名字，您想留下什么故事？
- 低负担问法　以前有人叫过您小名吗？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 家里传下来的故事（life-family-stories）

使用前提　区分亲历与听来的家史，不追考世系或要求证实传说。

- 起问　家里传下来的故事，您想讲哪一段？
- 场景追问　您当初是听谁讲的？
- 个人体验　哪一处让您一直记着？
- 意义与寄语　这段故事里，您最想留住什么？
- 低负担问法　那段故事是长辈讲的吗？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 普通的一天（life-routine）

使用前提　先由本人确定某段日常，使用他熟悉的一天，不要求完整作息表。

- 起问　那时候，早上起来先忙什么？
- 场景追问　忙完以后，接着做什么？
- 个人体验　一天里，哪个时段您能歇一会儿？
- 意义与寄语　那种日子，有什么让您惦记？
- 低负担问法　那时早上要自己做饭吗？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[UNC Southern Oral History Program · Life History Interviews: Sample Questions](https://sohp.org/wp-content/uploads/2022/12/Life-History-Questions.pdf)。

### 自己做过的决定（life-decision）

使用前提　只接本人提到的具体决定，不要求挑出一生最大的选择。

- 起问　那次您是怎么拿定主意的？
- 场景追问　决定之前，您做过什么准备？
- 个人体验　当时，您最看重哪一点？
- 意义与寄语　后来，您对这个决定有过新想法吗？
- 低负担问法　那件事您跟别人商量过吗？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[Abraham Lincoln Presidential Library and Museum · Interview Outline — Family Memories](https://presidentlincoln.illinois.gov/research/research-divisions/oral-history/volunteer-resources/interview-outline-family-memories/)。

### 一家人的开销（life-household-money）

使用前提　本人愿意谈生活安排，不问账户、金额或给理财建议；购买追问须有事实前提。

- 起问　那时候，家里的钱通常先用在哪儿？
- 场景追问　有没有一样东西，攒了钱才买？
- 个人体验　那次您怎样决定先买它？
- 意义与寄语　后来，您安排开销的想法变过吗？
- 低负担问法　那时常要留些钱买菜吗？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[UNC Southern Oral History Program · Life History Interviews: Sample Questions](https://sohp.org/wp-content/uploads/2022/12/Life-History-Questions.pdf)。

### 街坊与社区生活（life-community）

使用前提　本人愿意谈邻里和公共生活，不预设参加组织或担任职务。

- 起问　以前街坊常在哪里碰面？
- 场景追问　碰面以后，大家通常做什么？
- 个人体验　您在那儿参与过什么事？
- 意义与寄语　那个地方后来有过什么变化？
- 低负担问法　街坊之间常串门吗？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[Smithsonian · Some Possible Questions](https://folklife.si.edu/the-smithsonian-folklife-and-oral-history-interviewing-guide/some-possible-questions/smithsonian)。

### 一直看重的事（life-belief）

使用前提　本人主动谈价值观、信仰或做人做事，不推定宗教或评价对错。

- 起问　有什么事，您一直觉得值得坚持？
- 场景追问　您是哪次经历后这样想的？
- 个人体验　遇到难办的事，您会怎样取舍？
- 意义与寄语　这份想法，后来改变过吗？
- 低负担问法　您愿意讲一件相关的小事吗？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

### 退休后的生活（life-retirement）

使用前提　本人提到退休或停下固定工作，不把年龄当作退休事实。

- 起问　不再天天上班后，您先做了什么？
- 场景追问　那时的一天，您怎样安排？
- 个人体验　生活里，哪件事最需要重新适应？
- 意义与寄语　往后，您想把时间花在哪里？
- 低负担问法　那以后，您早上还起得早吗？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[UNC Southern Oral History Program · Life History Interviews: Sample Questions](https://sohp.org/wp-content/uploads/2022/12/Life-History-Questions.pdf)。

### 改变生活的新东西（life-technology）

使用前提　先确认本人提到的具体工具或技术，不预设会用手机或通电经历。

- 起问　用上它后，生活有什么变化？
- 场景追问　刚开始，您是怎么学会用的？
- 个人体验　哪种用法最合您的习惯？
- 意义与寄语　现在，您还保留着哪些老办法？
- 低负担问法　那件东西需要用电吗？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[UNC Southern Oral History Program · Life History Interviews: Sample Questions](https://sohp.org/wp-content/uploads/2022/12/Life-History-Questions.pdf)。

### 自己还想讲的事（life-unasked）

使用前提　作为自主选题或未结束时的补充入口；说累了、想停时直接结束。

- 起问　还有哪件事，是您想讲的？
- 场景追问　这件事，您想从哪里说起？
- 个人体验　这段故事，您最想讲清楚什么？
- 意义与寄语　往后的日子，您还想做点什么？
- 低负担问法　咱们接着聊您刚才说的事好吗？

使用提醒　根据本人意愿继续，不用开心、幸福等词替他评价。

主题依据　[StoryCorps · Great Questions](https://storycorps.org/participate/great-questions/)。

## 维护与验证

内容源为 app/src/framework.json。修改题目时同步本文件，维护 source_refs 与来源目录。app/test/framework.test.mjs 检查历史 ID、来源引用、单问题格式、文档同步、变量替换和运行时题组读取。

运行 npm test 验证兼容性，并从实际 nextTurn 入口进行文本访谈检查。声音、认知负担和长者接受度还需要真实参与者试用。
